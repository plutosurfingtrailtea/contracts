// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import '@openzeppelin/contracts/access/AccessControl.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import '@openzeppelin/contracts/utils/Pausable.sol';
import './Storage.sol';

contract Erc20Sale is AccessControl, ReentrancyGuard, Pausable {
  using SafeERC20 for IERC20;
  using Address for address;

  struct Token {
    bool defined;
    uint256 total;
  }

  bytes32 public constant ONRAMP_ROLE = keccak256('ONRAMP_ROLE');
  uint256 public constant UNITS = 1000000000000000000;
  uint256 public constant DECIMALS = 18;

  Storage private _storage;
  mapping(address => Token) private _tokens;

  event Erc20Recovered(address token, uint256 amount);
  event CoinRecovered(uint256 amount);
  event TokensPurchased(address indexed user, address indexed token, address indexed ref, uint256 amount, Storage.Option option, uint256 sold, uint256 round);

  error ErrClosed();
  error ErrRoundClosed();
  error ErrRoundAllocation();
  error ErrNullAddress();
  error ErrAmountZero();
  error ErrReferral();
  error ErrMin(uint256 amount_, uint256 min_);
  error ErrMax(uint256 amount_, uint256 max_);
  error ErrTokenUndefined();
  error ErrTransfer();

  constructor(address payable storage_, address[] memory tokens_) {
    if (storage_ == address(0)) {
      revert ErrNullAddress();
    }

    for(uint256 index = 0; index < tokens_.length; index++) {
      if (tokens_[index] == address(0)) revert ErrNullAddress();
      _tokens[tokens_[index]] = Token({
        defined: true,
        total: 0
      });
    }
    _storage = Storage(storage_);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  function pause()
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    _pause();
  }

  function unpause() 
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    _unpause();
  }

  function buy(address token_, uint256 amount_, Storage.Option option_, address ref_)
    external nonReentrant()
  {
    _buy(token_, amount_, option_, _msgSender(), ref_, false);
  }

  function buyFor(address token_, uint256 amount_, Storage.Option option_, address user_, address ref_)
    external nonReentrant() onlyRole(ONRAMP_ROLE)
  {
    _buy(token_, amount_, option_, user_, ref_, true);
  }

  function recoverErc20(address token_, uint256 amount_)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    IERC20(token_).safeTransfer(_msgSender(), amount_);

    emit Erc20Recovered(token_, amount_);
  }

  function isToken(address token_)
    external view returns (bool)
  {
    return _tokens[token_].defined;
  }

  function getStorage()
    external view returns (address)
  {
    return address(_storage);
  }

  function getTotal(address token_)
    external view returns (uint256)
  {
    return _tokens[token_].total;
  }

  function _buy(address token_, uint256 amount_, Storage.Option option_, address user_, address ref_, bool max_)
    internal whenNotPaused
  {
    if (user_ == address(0)) {
      revert ErrNullAddress();
    }
    if (user_ == ref_) {
      revert ErrReferral();
    }
    if (amount_ == 0) {
      revert ErrAmountZero();
    }
    if (!_tokens[token_].defined) {
      revert ErrTokenUndefined();
    }
    if (!_storage.isActive()) {
      revert ErrClosed();
    }
    Storage.Round memory round = _storage.getRound(_storage.getCurrentRound());
    if (round.state != Storage.State.Opened) {
      revert ErrRoundClosed();
    }
    if (round.supply < round.sold + _getSold(token_, amount_, option_)) {
      revert ErrRoundAllocation();
    }

    uint256 decimals = IERC20Metadata(token_).decimals();
    uint256 funds = (amount_ * UNITS) / (10 ** decimals);
    if (_storage.getMin() > funds) {
      revert ErrMin(funds, _storage.getMin());
    }
    uint256 limit = max_ ? _storage.maxLimitOf(user_) : _storage.limitOf(user_);
    if (limit < funds) {
      revert ErrMax(funds, limit);
    }

    (address ref, uint256 fTokenFunds, uint256 sTokenFunds) = _getRef(user_, token_, ref_, option_, amount_);
    _purchase(_msgSender(), token_, amount_, fTokenFunds);

    _tokens[token_].total = _tokens[token_].total + amount_;
    uint256 sold = _getSold(token_, amount_, option_);
    uint256 investment = (amount_ * UNITS) / (10 ** decimals);
    _storage.setState(user_, token_, investment, sold, ref_, fTokenFunds, sTokenFunds);

    emit TokensPurchased(user_, token_, ref, amount_, option_, sold, _storage.getCurrentRound());
  }

  function _purchase(address user_, address token_, uint256 amount_, uint256 reward_)
    internal
  {
    address treasury = _storage.getTreasury();
    IERC20(token_).safeTransferFrom(user_, treasury, amount_ - reward_);
    if (reward_ > 0) {
      IERC20(token_).safeTransferFrom(user_, address(_storage), reward_);
    }
  }

  function _getRef(address user_, address token_, address ref_, Storage.Option option_, uint256 amount_)
    internal view returns (address, uint256, uint256)
  {
    address ref = _storage.getRef(user_, ref_);
    if (ref == address(0)) {
      return (ref, 0, 0);
    }
    (uint256 fReward_, uint256 secondaryReward_) = _storage.getRefRates(ref);
    uint256 fTokenFunds = amount_ * fReward_ / 1000;
    uint256 sTokenFunds = amount_ * secondaryReward_ / 1000;
    uint256 sTokenSold = _getSold(token_, sTokenFunds, option_);

    return (ref, fTokenFunds, sTokenSold);
  }

  function _getSold(address token_, uint256 amount_, Storage.Option option_)
    internal view returns (uint256)
  {
    uint8 decimals = IERC20Metadata(token_).decimals();
    return (amount_ * 10 ** DECIMALS * UNITS / 10 ** decimals) / _storage.getPrice(option_);
  }
}