// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol';

contract DAI is ERC20, ERC20Permit {
  constructor() ERC20('DAI', 'DAI') ERC20Permit('DAI') {}

  function mint(uint256 amountToMint) public {
    _mint(msg.sender, amountToMint);
  }
}
