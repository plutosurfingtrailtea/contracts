require('dotenv').config();
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-ledger';

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    }
  },
  networks: {
    eth: {
      url: process.env.ETH_URL,
      ledgerAccounts: [process.env.LEDGER_ACCOUNT || '']
      //accounts: [process.env.PRIVATE_KEY || '']
    },
    bsc: {
      url: process.env.BSC_URL,
      ledgerAccounts: [process.env.LEDGER_ACCOUNT || '']
      //accounts: [process.env.PRIVATE_KEY || '']
    },
    sepolia: {
      url: process.env.SEPOLIA_URL,
      accounts: [process.env.PRIVATE_KEY || '']
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  }
};

export default config;
