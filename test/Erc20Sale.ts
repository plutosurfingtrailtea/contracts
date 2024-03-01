import { expect, use } from 'chai';
import { ethers } from 'hardhat';
import { toBigInt, ZeroAddress } from 'ethers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { DAI, Storage, Erc20Sale, USDC } from '../typechain-types';

use(require('chai-bignumber')());


// Constants
const _1D_18      = toBigInt('1000000000000000000');        // 10^18
const _1D_12      = toBigInt('1000000000000');              // 10^12

const _10M_TOKEN    = toBigInt('10000000000000000000000000'); // 10M TOKEN
const _10K_USDC   = toBigInt('10000000000');                // 10K USDC
const _200K_USDC  = toBigInt('200000000000');               // 200K USDC
const _200K_DAI   = toBigInt('200000000000000000000000');   // 200K DAI

const PRICE_S     = toBigInt('350000000000000000');         // 350000000000000000 / 10^18 = 0.35USD
const PRICE_L     = toBigInt('300000000000000000');         // 300000000000000000 / 10^18 = 0.3USD

const MIN     = toBigInt('25000000000000000000');       // 25000000 / 10^18 = 25USD
const LOW     = toBigInt('7500000000000000000000');     // 7500000000 / 10^18 = 7500USD
const CAP_MEDIUM  = toBigInt('30000000000000000000000');    // 30000000000 / 10^18 = 30000USD
const HIGH    = toBigInt('100000000000000000000000');   // 100000000000 / 10^18 = 100000USD

describe('Erc20Sale', async () => {
  async function deployFixture(): Promise<{
    coinSale: Erc20Sale,
    storage: Storage, 
    dai: DAI,
    usdc: USDC,
    usdt: USDC,
    accounts: {
      owner: HardhatEthersSigner,
      apt: HardhatEthersSigner,
      sol: HardhatEthersSigner,
      ava: HardhatEthersSigner,
      ref: HardhatEthersSigner
    };
  }> {
    // Accounts
    const signers = await ethers.getSigners();
    const accounts = {
      owner: signers[0],
      apt: signers[1],
      sol: signers[2],
      ava: signers[3],
      ref: signers[4]
    };

    // Factories
    const usdcFactory = await ethers.getContractFactory('USDC');
    const daiFactory = await ethers.getContractFactory('DAI');
    const storageFactory = await ethers.getContractFactory('Storage');
    const coinSaleFactory = await ethers.getContractFactory('Erc20Sale');
    
    const storage = await storageFactory.deploy(accounts.owner.address);
    
    const usdc = await usdcFactory.deploy();
    const dai = await daiFactory.deploy();
    const usdt = await usdcFactory.deploy();
    const coinSale = await coinSaleFactory.deploy(storage.target, [usdc.target, dai.target]);
    
    const idoController = await storage.OPERATOR_ROLE();
    await storage.grantRole(idoController, coinSale.target);
    
    await storage.setMax(HIGH);
    await storage.setMin(MIN);
    await storage.setAuthLimit(LOW);

    await usdc.connect(accounts.apt).mint(_200K_USDC);
    await usdc.connect(accounts.apt).approve(coinSale.target, _200K_USDC);
    await usdc.connect(accounts.sol).mint(_200K_USDC);
    await usdc.connect(accounts.sol).approve(coinSale.target, _200K_USDC);
    await usdc.connect(accounts.ava).mint(_200K_USDC);
    await usdc.connect(accounts.ava).approve(coinSale.target, _200K_USDC);

    await usdt.connect(accounts.apt).mint(_200K_USDC);
    await usdt.connect(accounts.apt).approve(coinSale.target, _200K_USDC);
    await usdt.connect(accounts.sol).mint(_200K_USDC);
    await usdt.connect(accounts.sol).approve(coinSale.target, _200K_USDC);
    await usdt.connect(accounts.ava).mint(_200K_USDC);
    await usdt.connect(accounts.ava).approve(coinSale.target, _200K_USDC);

    await dai.connect(accounts.apt).mint(_200K_DAI);
    await dai.connect(accounts.apt).approve(coinSale.target, _200K_DAI);
    await dai.connect(accounts.sol).mint(_200K_DAI);
    await dai.connect(accounts.sol).approve(coinSale.target, _200K_DAI);
    await dai.connect(accounts.ava).mint(_200K_DAI);
    await dai.connect(accounts.ava).approve(coinSale.target, _200K_DAI);

    return { accounts, coinSale, storage, usdc, dai, usdt };
  }

  it('should be deployable', async () => {
    const { coinSale, storage, accounts, usdc } = await loadFixture(deployFixture);

    const idoAddress = await coinSale.getAddress();
    expect(idoAddress.length).to.equal(42);

    expect(await coinSale.getStorage()).to.equal(storage.target);
    expect(await storage.getTreasury()).to.equal(accounts.owner.address);
    expect(await coinSale.getTotal(usdc.target)).to.equal(0);
    expect(await coinSale.isToken(usdc.target)).to.equal(true);
  });

  it('should allow to open coinSale for authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);
  });

  it('should disallow to open coinSale for unauthorized', async () => {
    const { storage, accounts } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).open())
      .to.be.rejectedWith();
  });

  it('should disallow to open round for unauthorized', async () => {
    const { storage, accounts } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();

    await expect(storage.connect(accounts.ava).openRound(0))
      .to.be.rejectedWith();
  });

  it('should disallow to setup default ref if unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).setRefRate(100, 50))
      .to.be.rejectedWith();
  });

  it('should allow to setup default ref', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.setRefRate(100, 55);
    const rewards = await storage.getRefRates();
    expect(rewards[0]).to.be.equal(toBigInt(100));
    expect(rewards[1]).to.be.equal(toBigInt(55));
  });

  it('should allow to enable ref', async () => {
    const { accounts, storage, coinSale, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await storage.disableReferral(accounts.ref.address);  
    await expect(storage.enableReferral(accounts.ref.address))
      .to.emit(storage, 'ReferralEnabled').withArgs(accounts.ref.address);
  });

  it('should disallow to enable for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).enableReferral(accounts.ava.address))
      .to.be.rejectedWith();
  });

  it('should allow to disable ref', async () => {
    const { accounts, storage, coinSale, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await expect(storage.disableReferral(accounts.ref.address))
      .to.emit(storage, 'ReferralDisabled').withArgs(accounts.ref.address);
  });

  it('should disallow to disable for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await expect(storage.connect(accounts.ava).disableReferral(accounts.ava.address))
      .to.be.rejectedWith();
  });

  it('should allow to open coinSale for authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);
  });

  it('can set limit for AUTH for authorized', async () => {
    const { storage } = await loadFixture(deployFixture);

    expect(await storage.getAuthLimit()).to.equal(LOW);
    const newLimit = MIN + toBigInt(1);
    await storage.setAuthLimit(newLimit);
    expect(await storage.getAuthLimit()).to.equal(newLimit);
  });

  it('cannot set limit for AUTH for unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    expect(await storage.getAuthLimit()).to.equal(LOW);
    const newLimit = MIN + toBigInt(1);

    await expect(storage.connect(accounts.ava).setAuthLimit(newLimit))
      .to.be.rejectedWith();
  });

  it('should not be able to buy tokens when coinSale closed', async () => {
    const { accounts, coinSale, usdc } = await loadFixture(deployFixture);

    await expect(coinSale.buy(usdc.target, _200K_USDC, 0, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'ErrClosed');
  });

  it('should not be able to buy amount of tokens less than minimum amount', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = (MIN / _1D_12) - toBigInt(1);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'ErrMin');
  });

  it('should not be able to buy amount of tokens less than minimum amount in DAI', async () => {
    const { accounts, coinSale, storage, dai } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const daiAmount = MIN - toBigInt(1);

    await expect(coinSale.connect(accounts.ava).buy(dai.target, daiAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'ErrMin');
  });

  it('should not be able to buy small amount of tokens with wrong token', async () => {
    const { accounts, coinSale, storage, usdt } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdtAmount = MIN / _1D_12;

    await expect(coinSale.connect(accounts.ava).buy(usdt.target, usdtAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'ErrTokenUndefined');
  });

  it('should be able to buy small amount of tokens without AUTH approve', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
  });

  it('should be able to buy small amount of tokens without AUTH approve with increased default ref rewards', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await storage.setRefRate(100, 50);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmount5Fee = usdcAmount * toBigInt(50) / toBigInt(1000);
    const usdcAmount10Fee = usdcAmount * toBigInt(100) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmount5Fee + usdcAmount10Fee);
  });

  it('should be able to buy small amount of tokens without AUTH approve with increased default ref rewards for custom ref', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await storage.setupReferrals([accounts.ref.address], [70], [50]);
    await storage.setRefRate(100, 50);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmount5Fee = usdcAmount * toBigInt(50) / toBigInt(1000);
    const usdcAmount10Fee = usdcAmount * toBigInt(100) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmount5Fee + usdcAmount10Fee);
  });

  it('should be able to buy small amount of tokens without AUTH approve with short option', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_S;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 0, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 0, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 0, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 0, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
  });

  it('should be able to buy small amount of tokens without AUTH approve with custom ref', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setupReferrals([accounts.ref.address], [100], [50]);
    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmountFee = usdcAmount * toBigInt(200) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
  });

  it('should be able to buy small amount of tokens without AUTH approve with zero ref', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setupReferrals([accounts.ref.address], [100], [50]);
    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_S;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 0, ZeroAddress))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, ZeroAddress, usdcAmount, 0, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 0, ZeroAddress))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, ZeroAddress, usdcAmount, 0, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - (MIN * toBigInt(2)));

    expect(await storage.refBalanceOf(usdc.target, ZeroAddress)).to.equal(0);
  });

  it('should not be able to setup custom ref if not authorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);
    await expect(storage.connect(accounts.ava).setupReferrals([accounts.ref.address], [100], [50]))
      .to.be.rejectedWith();
  });

  it('should not be able to setup custom ref if coinSale closed', async () => {
    const { accounts, coinSale, storage } = await loadFixture(deployFixture);
    await storage.open();
    await storage.close();
    await expect(storage.setupReferrals([accounts.ref.address], [100], [50]))
      .to.be.revertedWithCustomError(coinSale, 'ErrClosed');
  });

  it('should be able to buy small amount of tokens without AUTH approve and claim ref rewards', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - MIN);

    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000) / toBigInt(2);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
    await storage.connect(accounts.ref).claimRef([usdc.target]);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(toBigInt(0));
    expect(await usdc.balanceOf(accounts.ref.address)).to.equal(usdcAmountFee);
  });

  it('should be able to buy small amount of tokens without AUTH approve and unable to claim ref rewards if ref disable', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
    expect(await storage.limitOf(accounts.ava.address)).to.equal(LOW - MIN);

    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000) / toBigInt(2);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
    await expect(storage.disableReferral(accounts.ref.address))
      .to.emit(storage, 'ReferralDisabled').withArgs(accounts.ref.address);

    await expect(storage.connect(accounts.ref).claimRef([usdc.target]))
      .to.be.revertedWithCustomError(storage, 'ErrRefDisabled');
  });

  it('should be able to buy small amount of tokens for another treasury without AUTH approve', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await coinSale.grantRole(await coinSale.ONRAMP_ROLE(), accounts.ava);

    const usdcAmount = MIN / _1D_12;
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buyFor(usdc.target, usdcAmount, 1, accounts.sol.address, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.sol.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    await expect(coinSale.connect(accounts.ava).buyFor(usdc.target, usdcAmount, 1, accounts.sol.address, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.sol.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.sol.address)).to.equal(tokenAmount * toBigInt(2));
    expect(await storage.limitOf(accounts.sol.address)).to.equal(LOW - (MIN * toBigInt(2)));

    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000);
    expect(await storage.refBalanceOf(usdc.target, accounts.ref.address)).to.equal(usdcAmountFee);
  });

  it('should be able to buy small amount of tokens with secondary token without AUTH approve', async () => {
    const { accounts, coinSale, storage, dai } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const daiAmount = MIN;
    const tokenAmount = daiAmount * _1D_18  / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(dai.target, daiAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, dai.target, accounts.ref.address, daiAmount, 1, tokenAmount, 0);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
  });

  it('should not be able to buy big amount of tokens without AUTH approve', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = (LOW / _1D_12) + toBigInt(1);

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(storage, 'ErrMax');
  });

  it('should not be able to pause if unauthorized', async () => {
    const { accounts, coinSale } = await loadFixture(deployFixture);

    await expect(coinSale.connect(accounts.ava).pause())
      .to.be.rejectedWith();
  });

  it('should not be able to buy tokens if paused', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    const usdcAmount = MIN / _1D_12;

    await coinSale.pause();
    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'EnforcedPause');
  });

  it('should not be able to buy big amount(> HIGH CAP) of tokens', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await storage.setAuthBatch([accounts.ava.address], [true]);
    expect(await storage.isAuth(accounts.ava.address)).to.equal(true);

    const usdcAmount = (HIGH / _1D_12) + toBigInt(1);
    
    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.be.revertedWithCustomError(coinSale, 'ErrMax');
  });
  
  it('should be able to buy tokens when AUTH approved', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);
    
    await storage.setAuthBatch([accounts.ava.address], [true]);
    expect(await storage.isAuth(accounts.ava.address)).to.equal(true);
  
    const round = 0;
    const usdcAmount = (CAP_MEDIUM / _1D_12) + toBigInt(1);
    const tokenAmount = usdcAmount * _1D_18 * _1D_12 / PRICE_L;

    expect(await usdc.balanceOf(accounts.owner.address)).to.equal(toBigInt(0));
    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, round);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
    const usdcAmountFee = usdcAmount * toBigInt(100) / toBigInt(1000) / toBigInt(2);
    expect(await usdc.balanceOf(accounts.owner.address)).to.equal(usdcAmount - usdcAmountFee);
  });

  it('should be able to buy tokens when AUTH approved with mixed assets', async () => {
    const { accounts, coinSale, storage, usdc, dai } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);
    
    await storage.setAuthBatch([accounts.ava.address], [true]);
    expect(await storage.isAuth(accounts.ava.address)).to.equal(true);

    const round = 0;
    const usdcAmount = (CAP_MEDIUM / _1D_12) + toBigInt(1);
    const daiAmount = CAP_MEDIUM + toBigInt(1);

    const tokenAmountForUSDC = usdcAmount * _1D_12 * _1D_18 / PRICE_L;
    const tokenAmountForDAI = daiAmount * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmountForUSDC, round);
    await expect(coinSale.connect(accounts.ava).buy(dai.target, daiAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, dai.target, accounts.ref.address, daiAmount, 1, tokenAmountForDAI, round);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmountForUSDC + tokenAmountForDAI);
  });

  it('should be able to buy tokens when whitelist is optional', async () => {
    const { accounts, coinSale, storage, usdc } = await loadFixture(deployFixture);

    await storage.setRound(PRICE_S, PRICE_L, _10M_TOKEN);
    await storage.open();
    await storage.openRound(0);

    await storage.setAuthLimit(HIGH);   //AUTH (100K max)

    const round = 0;
    const usdcAmount = (CAP_MEDIUM / _1D_12) + toBigInt(1);
    const tokenAmount = usdcAmount * _1D_12 * _1D_18 / PRICE_L;

    await expect(coinSale.connect(accounts.ava).buy(usdc.target, usdcAmount, 1, accounts.ref.address))
      .to.emit(coinSale, 'TokensPurchased').withArgs(accounts.ava.address, usdc.target, accounts.ref.address, usdcAmount, 1, tokenAmount, round);

    expect(await storage.balanceOf(0, accounts.ava.address)).to.equal(tokenAmount);
  });

  it('cannot close an coinSale when unauthorized', async () => {
    const { accounts, storage } = await loadFixture(deployFixture);

    await storage.open();
    expect(await storage.isActive()).to.equal(true);

    //await storage.connect(accounts.ava).close();
    await expect(storage.connect(accounts.ava).close())
      .to.be.rejectedWith();
  });

  it('can close an coinSale when authorized', async () => {
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
});