import { expect, use } from 'chai';
import { ethers } from 'hardhat';
import { toBigInt, ZeroAddress } from 'ethers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Storage, CoinSale, PriceAggregatorV3, USDC } from '../typechain-types';

use(require('chai-bignumber')());

const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const _1D_18 = toBigInt('1000000000000000000');
const _10M_TOKEN = toBigInt('10000000000000000000000000');
const _10K_USDC = toBigInt('10000000000');
const _200K_USDC = toBigInt('200000000000');
const PRICE_S = toBigInt('350000000000000000');
const PRICE_L = toBigInt('300000000000000000');
const MIN = toBigInt('25000000000000000000');
const LOW = toBigInt('7500000000000000000000');
const HIGH = toBigInt('100000000000000000000000');

const now = () => Math.ceil(new Date().getTime() / 1000);

describe('CoinSale', async () => {
  async function deployFixture(): Promise<{
    coinSale: CoinSale,
    storage: Storage,
    priceAggregator: PriceAggregatorV3
    usdc: USDC
    accounts: {
      owner: HardhatEthersSigner,
      apt: HardhatEthersSigner,
      sol: HardhatEthersSigner,
      ava: HardhatEthersSigner,
      ref: HardhatEthersSigner
    };
  }> {
    const signers = await ethers.getSigners();
    const accounts = {
      owner: signers[0],
      apt: signers[1],
      sol: signers[2],
      ava: signers[3],
      ref: signers[4]
    };

    const priceAggregatorFactory = await ethers.getContractFactory('PriceAggregatorV3');
    const storageFactory = await ethers.getContractFactory('Storage');
    const coinSaleFactory = await ethers.getContractFactory('CoinSale');
    const usdcFactory = await ethers.getContractFactory('USDC');

    const priceAggregator = await priceAggregatorFactory.deploy();
    const storage = await storageFactory.deploy(accounts.owner.address);
    const coinSale = await coinSaleFactory.deploy(storage.target, priceAggregator.target, 3600);
    const usdc = await usdcFactory.deploy();

    const idoController = await storage.OPERATOR_ROLE();
    await storage.grantRole(idoController, coinSale.target);
    await storage.setMax(HIGH);
    await storage.setMin(MIN);
    await storage.setAuthLimit(LOW);
    await usdc.connect(accounts.apt).mint(_200K_USDC);

    return { accounts, coinSale, storage, usdc, priceAggregator };
  }

  it('should be deployable', async () => {
    const { coinSale, storage, accounts } = await loadFixture(deployFixture);

    expect(coinSale.target.toString().length).to.equal(42);
    expect(await coinSale.getStorage()).to.equal(storage.target);
    expect(await coinSale.getTotal()).to.equal(0);
    expect(await storage.getTreasury()).to.equal(accounts.owner.address);
  });

  it('should allow to change treasury for authorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await storage.setTreasury(accounts.ava);
    expect(await storage.getTreasury()).to.equal(accounts.ava.address);
  });

  it('should disallow to change treasury for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).setTreasury(accounts.sol)).to.be.rejectedWith();
  });

  it('should allow to open coinsale for authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);
  });

  it('should disallow to open coinsale for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).open()).to.be.rejectedWith();
  });

  it('should disallow to open round for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();

    await expect(storage.connect(accounts.ava).openRound(0)).to.be.rejectedWith()
  });

  it('can set limit for authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    expect(await storage.getAuthLimit()).to.equal(LOW);
    const newLimit = MIN + toBigInt(1);
    await storage.setAuthLimit(newLimit);
    expect(await storage.getAuthLimit()).to.equal(newLimit);
  });

  it('cannot set limit for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    expect(await storage.getAuthLimit()).to.equal(LOW);
    const newLimit = MIN + toBigInt(1);
    await expect(storage.connect(accounts.ava).setAuthLimit(newLimit)).to.be.rejectedWith();
  });

  it('should not be able to buy tokens when coinsale closed', async () => {
    const { accounts, coinSale } = await loadFixture(deployFixture);

    await expect(coinSale.buy(0, accounts.ref.address, {value: '10000000000000000'}))
      .to.be.revertedWithCustomError(coinSale, 'ErrClosed');
  });

  it('should not be able to buy amount of tokens less than minimum amount', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: '9000000000000000'}))
      .to.be.revertedWithCustomError(coinSale, 'ErrMin');
  });

  it('should not be able to buy tokens if price feed update threshold exceeded', async () => {
    const { accounts, storage, coinSale, priceAggregator } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';
    await priceAggregator.setTimestamp(now() - 3600);

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: ethAmount}))
      .to.be.revertedWithCustomError(coinSale, 'ErrPriceThreshold');
  });

  it('should be able to buy small amount of tokens without AUTH approve', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    
    expect(await storage.getMax()).to.equal(HIGH);
    expect(await storage.getPrice(1)).to.equal(0);

    await storage.openRound(0);
    expect(await storage.getPrice(1)).to.equal(PRICE_L);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (limitAmount * toBigInt(2)));
    expect(await storage.getRef(accounts.ava.address, accounts.ref.address)).to.equal(accounts.ref.address);

    await storage.disableReferral(accounts.ref.address);
    expect(await storage.getRef(accounts.ava.address, accounts.ref.address)).to.equal(ZeroAddress);

    await storage.setAuthLimit(limitAmount);
    expect(await storage.limitOf(accounts.ava.address)).to.equal(0);
  });

  it('should be able to buy small amount of tokens without AUTH approve with zero ref', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, ZeroAddress, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, ZeroAddress, ethAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(1, ZeroAddress, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, ZeroAddress, ethAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
  });

  it('should be able to buy small amount of tokens for another treasury without AUTH approve', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await coinSale.grantRole(await coinSale.ONRAMP_ROLE(), accounts.ava);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buyFor(1, accounts.sol.address, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.sol.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buyFor(1, accounts.sol.address, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.sol.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.sol.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.sol.address)).to.equal(LOW - (limitAmount * toBigInt(2)));
  });

  it('should be able to buy small amount of tokens without AUTH approve with the short option', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_S;

    await expect(coinSale.connect(accounts.ava).buy(0, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 0, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(0, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 0, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (limitAmount * toBigInt(2)));
  });

  it('should be able to buy small amount of tokens without AUTH approve and claim ref rewards', async () => {
    const { accounts, storage, coinSale, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    const ethAmountFee = toBigInt(ethAmount) * toBigInt(100) / toBigInt(1000) / toBigInt(2);
    expect(await storage.refBalanceOf(ETH, accounts.ref.address)).to.equal(ethAmountFee);
    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - toBigInt(limitAmount));
    expect(await storage.getTotalSold()).to.equal(tokenAmount);
    await storage.connect(accounts.ref).claimRef([ETH, usdc.target]);
    expect(await storage.refBalanceOf(ETH, accounts.ref.address)).to.equal(toBigInt(0));
  })

  it('should be able to buy small amount of tokens without AUTH approve and unable to claim ref rewards if ref disable', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    expect(await storage.getRoundsCount()).to.equal(1);

    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';
    const limitAmount = toBigInt('25000000000000000000');
    const tokenAmount = limitAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, {value: ethAmount}))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, 0);

    const ethAmountFee = toBigInt(ethAmount) * toBigInt(100) / toBigInt(1000) / toBigInt(2);
    expect(await storage.refBalanceOf(ETH, accounts.ref.address)).to.equal(ethAmountFee);
    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - limitAmount);

    await expect(storage.disableReferral(accounts.ref.address))
      .to.emit(storage, 'ReferralDisabled').withArgs(accounts.ref.address);
  })

  it('should not be able to buy big amount of tokens without AUTH approve', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '3000100000000000000';

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, { value: ethAmount }))
      .to.be.revertedWithCustomError(coinSale, 'ErrMax');
  });

  it('should not be able to pause if unauthorized', async () => {
    const { accounts, coinSale } = await loadFixture(deployFixture);

    await expect(coinSale.connect(accounts.ava).pause())
      .to.be.rejectedWith();
  });

  it('should not be able to buy tokens if paused', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const ethAmount = '10000000000000000';

    await coinSale.pause();

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, { value: ethAmount }))
      .to.be.revertedWithCustomError(coinSale, 'EnforcedPause');
  });

  it('should not be able to buy big amount(> HIGH CAP) of tokens', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await storage.setAuthBatch([accounts.ava.address], [true]);
    expect(await storage.isAuth(accounts.ava.address)).to.equal(true);

    const ethAmount = '120000100000000000000';

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, { value: ethAmount }))
      .to.be.revertedWithCustomError(coinSale, 'ErrMax');
  });
  
  it('should be able to buy tokens when AUTH approved', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);
    
    await storage.setAuthBatch([accounts.ava.address], [true]);
    expect(await storage.isAuth(accounts.ava.address)).to.equal(true);
  
    const round = 0;
    const ethAmount = '20000000000000000000';
    const tokenAmount = toBigInt('50000000000000000000000') * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, { value: ethAmount }))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, round);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);

    await storage.setMax(MIN);
    expect(await storage.maxLimitOf(accounts.ava.address)).to.equal(0);
  });

  it('should be able to buy tokens when whitelist is optional', async () => {
    const { accounts, storage, coinSale } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await storage.setAuthLimit(HIGH);   //AUTH (100K max)
    const round = 0;
    const ethAmount = '20000000000000000000';
    const tokenAmount = toBigInt('50000000000000000000000') * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(1, accounts.ref.address, { value: ethAmount }))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, accounts.ref.address, ethAmount, 1, tokenAmount, round);
    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
  });

  it('cannot close the coinSale when unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);

    await expect(storage.connect(accounts.ava).close())
      .to.be.rejectedWith();
  });

  it('can close the coinSale when authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);

    await storage.close();
    expect(await storage.isInactive()).to.equal(true);
  });
  
  it('should close the round', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);
    await storage.closeRound(0);
    expect((await storage.getRound(0)).state).to.equal(2);
  });

  it('should not be able to recover ERC20 from storage if unauthorized', async () => {
    const { storage, usdc, accounts } = await loadFixture(deployFixture);

    await usdc.connect(accounts.apt).transfer(storage.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.apt.address)).to.equal(_200K_USDC - _10K_USDC);
    expect(await usdc.balanceOf(storage.target)).to.equal(_10K_USDC);
    
    await expect(storage.connect(accounts.ava).recoverErc20(usdc.target, _10K_USDC)).to.be.rejectedWith();
  });

  it('should be able to recover ERC20 from storage', async () => {
    const { storage, usdc, accounts } = await loadFixture(deployFixture);

    await usdc.connect(accounts.apt).transfer(storage.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.apt.address)).to.equal(_200K_USDC - _10K_USDC);
    expect(await usdc.balanceOf(storage.target)).to.equal(_10K_USDC);
    
    await storage.recoverErc20(usdc.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.owner.address)).to.equal(_10K_USDC);
    expect(await usdc.balanceOf(storage.target)).to.equal(toBigInt(0));
  });

  it('should not be able to recover native coin from storage if unauthorized', async () => {
    const { storage, accounts } = await loadFixture(deployFixture);

    const ethBalance = toBigInt('1000000000000000000');
    const tx = { to: storage.target, value: ethBalance };
    await accounts.owner.sendTransaction(tx);

    expect(await ethers.provider.getBalance(storage.target)).to.equal(ethBalance);
    await expect(storage.connect(accounts.ava).recoverCoin()).to.be.rejectedWith();
  });

  it('should be able to recover native coin from storage', async () => {
    const { storage, accounts } = await loadFixture(deployFixture);

    const ownerBalance = await ethers.provider.getBalance(accounts.owner.address);
    const ethGas = toBigInt('10000');
    const ethBalance = toBigInt('1000000000000000000');
    const tx = { to: storage.target, value: ethBalance };
    await accounts.owner.sendTransaction(tx);

    expect(await ethers.provider.getBalance(storage.target)).to.equal(ethBalance);
    expect(await ethers.provider.getBalance(accounts.owner.address)).to.lessThanOrEqual(ownerBalance - ethBalance);

    await storage.recoverCoin();
    expect(await ethers.provider.getBalance(accounts.owner.address)).to.lessThanOrEqual(ownerBalance - ethGas);
  });

  it('should not be able to recover ERC20 from coinSale', async () => {
    const { coinSale, usdc, accounts } = await loadFixture(deployFixture);

    await usdc.connect(accounts.apt).transfer(coinSale.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.apt.address)).to.equal(_200K_USDC - _10K_USDC);
    expect(await usdc.balanceOf(coinSale.target)).to.equal(_10K_USDC);
    
    await expect(coinSale.connect(accounts.ava).recoverErc20(usdc.target, _10K_USDC)).to.be.rejectedWith();
  });

  it('should be able to recover ERC20 from coinSale', async () => {
    const { coinSale, usdc, accounts } = await loadFixture(deployFixture);

    await usdc.connect(accounts.apt).transfer(coinSale.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.apt.address)).to.equal(_200K_USDC - _10K_USDC);
    expect(await usdc.balanceOf(coinSale.target)).to.equal(_10K_USDC);
    
    await coinSale.recoverErc20(usdc.target, _10K_USDC);
    expect(await usdc.balanceOf(accounts.owner.address)).to.equal(_10K_USDC);
    expect(await usdc.balanceOf(coinSale.target)).to.equal(toBigInt(0));
  });

  it('should not be able to recover native coin from coinSale if unauthorized', async () => {
    const { coinSale, accounts } = await loadFixture(deployFixture);

    const ethBalance = toBigInt('1000000000000000000');
    const tx = { to: coinSale.target, value: ethBalance };
    await accounts.owner.sendTransaction(tx);

    expect(await ethers.provider.getBalance(coinSale.target)).to.equal(ethBalance);
    await expect(coinSale.connect(accounts.ava).recoverCoin()).to.be.rejectedWith();
  });

  it('should be able to recover native coin from coinSale', async () => {
    const { coinSale, accounts } = await loadFixture(deployFixture);

    const ownerBalance = await ethers.provider.getBalance(accounts.owner.address);
    const ethGas = toBigInt('10000');
    const ethBalance = toBigInt('1000000000000000000');
    const tx = { to: coinSale.target, value: ethBalance };
    await accounts.owner.sendTransaction(tx);

    expect(await ethers.provider.getBalance(coinSale.target)).to.equal(ethBalance);
    expect(await ethers.provider.getBalance(accounts.owner.address)).to.lessThanOrEqual(ownerBalance - ethBalance);

    await coinSale.recoverCoin();
    expect(await ethers.provider.getBalance(accounts.owner.address)).to.lessThanOrEqual(ownerBalance - ethGas);
  });
});