import * as hre from 'hardhat';

const snooze = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('Start.');
  // Constants
  const STORAGE     = 'Storage';
  const COIN_SALE   = 'CoinSale';
  const ERC20_SALE  = 'Erc20Sale';

  // Account
  const owner = (await hre.ethers.getSigners())[0].address;

  // Define factories
  const storageFactory = await hre.ethers.getContractFactory(STORAGE);
  const erc20SaleFactory = await hre.ethers.getContractFactory(ERC20_SALE);
  const coinSaleFactory = await hre.ethers.getContractFactory(COIN_SALE);

  // Deploy sale contracts
  const treasury = '0xCE30537A0e81795A4142110B46060EB05c987C70';
  const storage = await storageFactory.deploy(treasury);
  console.log(`Storage: ${storage.target}`);
  await snooze(10000);

  // feed(ETH/USD): 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
  const priceOracle = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
  const coinSale = await coinSaleFactory.deploy(storage.target, priceOracle, 91 * 60);
  console.log(`CoinSale: ${coinSale.target}`);
  await snooze(10000);

  const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const erc20Sale = await erc20SaleFactory.deploy(storage.target, [usdt, usdc]);
  console.log(`Erc20Sale: ${erc20Sale.target}`);
  await snooze(10000);

  // Setup roles
  const OPERATOR_ROLE = '0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929';
  await storage.grantRole(OPERATOR_ROLE, coinSale.target);
  await snooze(10000);
  await storage.grantRole(OPERATOR_ROLE, erc20Sale.target);
  await snooze(10000);

  console.log('Done.');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });