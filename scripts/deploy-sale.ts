import * as hre from 'hardhat';

const snooze = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('Start.');
  // Constants
  const DAI         = 'DAI';
  const USDC        = 'USDC';
  const STORAGE     = 'Storage';
  const COIN_SALE   = 'CoinSale';
  const ERC20_SALE  = 'Erc20Sale';

  // Account
  const owner = (await hre.ethers.getSigners())[0].address;

  // Define factories
  const daiFactory = await hre.ethers.getContractFactory(DAI);
  const usdcFactory = await hre.ethers.getContractFactory(USDC);
  const storageFactory = await hre.ethers.getContractFactory(STORAGE);
  const erc20SaleFactory = await hre.ethers.getContractFactory(ERC20_SALE);
  const coinSaleFactory = await hre.ethers.getContractFactory(COIN_SALE);

  // Deploy token contracts
  const dai = await daiFactory.deploy();
  console.log(`DAI: ${dai.target}`);
  await snooze(10000);

  const usdc = await usdcFactory.deploy();
  console.log(`USDC: ${usdc.target}`);
  await snooze(10000);

  // Deploy sale contracts
  const treasury = owner;
  const storage = await storageFactory.deploy(treasury);
  console.log(`Storage: ${storage.target}`);
  await snooze(10000);

  // feed(ETH/USD): 0x694AA1769357215DE4FAC081bf1f309aDC325306
  const priceOracle = '0x694AA1769357215DE4FAC081bf1f309aDC325306';
  const coinSale = await coinSaleFactory.deploy(storage.target, priceOracle, 3600);
  console.log(`CoinSale: ${coinSale.target}`);
  await snooze(10000);

  const erc20Sale = await erc20SaleFactory.deploy(storage.target, [usdc.target, dai.target]);
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