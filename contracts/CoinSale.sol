// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/AccessControl.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import '@openzeppelin/contracts/utils/Pausable.sol';
import '@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol';
import './Storage.sol';

contract CoinSale is AccessControl, ReentrancyGuard, Pausable {
  using SafeERC20 for IERC20;
  using Address for address;
  bytes32 public constant ONRAMP_ROLE = keccak256('ONRAMP_ROLE');
  address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  
  uint256 public constant DECIMALS = 18;
  uint256 public constant UNITS = 1000000000000000000;
  uint256 private _total;
  Storage private _storage;
  
  AggregatorV3Interface private _priceFeed;
  uint256 private _priceThreshold;

  event PriceThresholdUpdated(uint256 priceFeedTimeThreshold);
  event Erc20Recovered(address token, uint256 amount);
  event CoinRecovered(uint256 amount);
  event TokensPurchased(address indexed user, address indexed ref, uint256 amount, Storage.Option indexed option, uint256 sold, uint256 round);

  error ErrClosed();
  error ErrRoundClosed();
  error ErrNullAddress();
  error ErrInvalidPriceThreshold();
  error ErrRoundAllocation();
  error ErrPriceThreshold();
  error ErrUserNullAddress();
  error ErrAmountZero();
  error ErrReferral();
  error ErrTransfer();
  error ErrMin(uint256 amount_, uint256 min_);
  error ErrMax(uint256 amount_, uint256 max_);

  constructor(address payable storage_, address priceFeed_, uint256 priceThreshold_) {
    if (storage_ == address(0) || priceFeed_ == address(0)) {
      revert ErrNullAddress();
    }
    if (priceThreshold_ == 0) {
      revert ErrInvalidPriceThreshold();
    }

    _storage = Storage(storage_);
    _priceFeed = AggregatorV3Interface(priceFeed_);
    _priceThreshold = priceThreshold_;    

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

  function buy(Storage.Option option_, address ref_)
    external payable nonReentrant()
  {
    _buy(option_, _msgSender(), ref_, false);
  }

  function buyFor(Storage.Option option_, address user_, address ref_)
    external payable onlyRole(ONRAMP_ROLE) nonReentrant()
  {
    _buy(option_, user_, ref_, true);
  }

  function setPriceThreshold(uint256 priceThreshold_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    _priceThreshold = priceThreshold_;

    emit PriceThresholdUpdated(priceThreshold_);
  }

  function recoverCoin()
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {    
    uint256 balance = address(this).balance;
    _msgSender().call{value: balance}('');

    emit CoinRecovered(balance);
  }

  function recoverErc20(address token_, uint256 amount_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    IERC20(token_).safeTransfer(_msgSender(), amount_);

    emit Erc20Recovered(token_, amount_);
  }

  function getStorage()
    external view returns (address)
  {
    return address(_storage);
  }
  
  function getTotal()
    external view returns (uint256)
  {
    return _total;
  }

  function getPriceThreshold()
    external view returns (uint256)
  {
    return _priceThreshold;
  }

  function _buy(Storage.Option option_, address user_, address ref_, bool max_)
    internal whenNotPaused()
  {
    uint256 amount = msg.value;
    if (user_ == address(0)) {
      revert ErrUserNullAddress();
    }
    if (user_ == ref_) {
      revert ErrReferral();
    }
    if (amount == 0) {
      revert ErrAmountZero();
    }
    if (!_storage.isActive()) {
      revert ErrClosed();
    }
    Storage.Round memory round = _storage.getRound(_storage.getCurrentRound());
    if (round.state != Storage.State.Opened) {
      revert ErrRoundClosed();
    }
    if (round.supply < round.sold + _getSold(amount, option_)) {
      revert ErrRoundAllocation();
    }
    uint8 decimals = _priceFeed.decimals();
    (, int256 price, , uint256 updatedAt,) = _priceFeed.latestRoundData();
    if (block.timestamp - updatedAt > _priceThreshold) {
      revert ErrPriceThreshold();
    }
    uint256 funds = (amount * uint256(price) * UNITS) / (10 ** (DECIMALS + decimals));
    if (_storage.getMin() > funds) {
      revert ErrMin(funds, _storage.getMin());
    }
    uint256 limit = max_ ? _storage.maxLimitOf(user_) : _storage.limitOf(user_);
    if (limit < funds) {
      revert ErrMax(funds, limit);
    }
    
    (address ref, uint256 coinFunds, uint256 tokenFunds) = _getRef(user_, ref_, option_, amount);
    _purchase(amount, coinFunds);
    
    _total = _total + amount;
    uint256 sold = _getSold(amount, option_);
    uint256 investment = (amount * uint256(price) * UNITS) / (10 ** (DECIMALS + decimals));
    _storage.setState(user_, ETH, investment, sold, ref_, coinFunds, tokenFunds);

    emit TokensPurchased(user_, ref, amount, option_, sold, _storage.getCurrentRound());
  }

  function _purchase(uint256 amount_, uint256 reward_)
    internal
  {
    address treasury = _storage.getTreasury();
    (bool success, ) = treasury.call{value: amount_ - reward_}('');
    if (!success) {
      revert ErrTransfer();
    }
    if (reward_ > 0) {
      (bool rSuccess, ) = address(_storage).call{value: reward_}('');
      if (!rSuccess) revert ErrTransfer();
    }
  }

  function _getRef(address user_, address ref_, Storage.Option option_, uint256 amount_)
    internal view returns (address, uint256, uint256)
  {
    address ref = _storage.getRef(user_, ref_);
    if (ref == address(0)) {
      return (ref, 0, 0);
    }
    (uint256 fRate, uint256 sRate) = _storage.getRefRates(ref);
    uint256 coinFunds = amount_ * fRate / 1000;
    uint256 tokenFunds = amount_ * sRate / 1000;
    uint256 tokenSold = _getSold(tokenFunds, option_);

    return (ref, coinFunds, tokenSold);
  }

  function _getSold(uint256 amount_, Storage.Option option_)
    internal view returns (uint256)
  {
    uint8 decimals = _priceFeed.decimals();
    (, int256 price, , uint256 updatedAt,) = _priceFeed.latestRoundData();
    if (block.timestamp - updatedAt > _priceThreshold) {
      revert ErrPriceThreshold();
    }

    return (amount_ * uint256(price) * UNITS) / _storage.getPrice(option_) / (10 ** decimals);
  }

  receive() external payable { }
}