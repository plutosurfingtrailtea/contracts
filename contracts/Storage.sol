// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import '@openzeppelin/contracts/access/AccessControl.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

contract Storage is AccessControl, ReentrancyGuard {
  using SafeERC20 for IERC20;

  enum Option { Short, Long }
  enum State { None, Opened, Closed }

  struct Round {
    bool defined;
    State state;
    uint256 sPrice;
    uint256 lPrice;
    uint256 sold;
    uint256 supply;
  }

  struct Referral {
    bool defined;
    bool enabled;
    uint256 firstRefRate;
    uint256 secondRefRate;
  }
  
  bytes32 public constant OPERATOR_ROLE = keccak256('OPERATOR_ROLE');
  address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  address internal constant TOKEN = 0x0000000000000000000000000000000000000001;
  uint256 internal constant MAX = 1000000000000000000000000;
  uint256 internal constant MIN = 1000000000000000000;

  address private _treasury;
  State private _state;

  Round[] private _rounds;
  uint256 private _currentRound;
  
  uint256 private _max;
  uint256 private _min;

  uint256 private _authLimit;
  mapping(address => bool) private _auth;

  uint256 private _firstRefRate = 50;
  uint256 private _secondRefRate = 50;

  uint256 private _totalSold;
  mapping(address => uint256) private _funds;
  mapping(address => mapping(uint256 => uint256)) private _balances;

  mapping(address => Referral) private _refs;
  mapping(address => address) private _refsUsers;
  mapping(address => mapping(address => uint256)) _refsBalances;

  event StateUpdated(State state);
  event RoundOpened(uint256 indexed round);
  event RoundClosed(uint256 indexed round);
  event RoundAdded(uint256 sPrice, uint256 lPrice, uint256 supply);
  event RoundPriceUpdated(uint256 indexed round, uint256 sPrice, uint256 lPrice);
  event RoundSupplyUpdated(uint256 indexed round, uint256 supply);
  event Erc20Recovered(address token, uint256 amount);
  event CoinRecovered(uint256 amount);
  event AuthLimitUpdated(uint256 limit);
  event AuthUserUpdated(address indexed user, bool value);
  event MaxUpdated(uint256 amount);
  event MinUpdated(uint256 amount);
  event TreasuryUpdated(address indexed treasury);
  event RefRateSetup(uint256 firstRefRate, uint256 secondRefRate);
  event ReferralSetup(address indexed ref, uint256 firstRefRate, uint256 secondRefRate);
  event ReferralEnabled(address indexed ref);
  event ReferralDisabled(address indexed ref);
  event ClaimedFunds(address indexed ref, address indexed token, uint256 amount);

  error ErrParamsInvalid();
  error ErrStarted();
  error ErrClosed();
  error ErrNullAddress(); 
  error ErrRoundUndefined(uint256 index_);
  error ErrRoundStarted(uint256 index_);
  error ErrRoundClosed(uint256 index_);
  error ErrRoundSupply(uint256 index_);
  error ErrMin(uint256 amount_, uint256 min_);
  error ErrMax(uint256 amount_, uint256 max_);
  error ErrAuthLimit(uint256 limit_, uint256 min_, uint256 max_);
  error ErrFirstRefFunds(uint256 reward_);
  error ErrSecondRefFunds(uint256 reward_);
  error ErrRefUndefined(address ref_);
  error ErrRefEnabled(address ref_);
  error ErrRefDisabled(address ref_);
  error ErrTokenUndefined();
  error ErrTransfer();

  constructor(address treasury_) {
    if (treasury_ == address(0)) {
      revert ErrNullAddress();
    }
    _treasury = treasury_;

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    _grantRole(OPERATOR_ROLE, _msgSender());
  }

  function open()
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (_state != State.None) {
      revert ErrStarted();
    }
    _state = State.Opened;

    emit StateUpdated(_state);
  }

  function close()
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (!isActive()) {
      revert ErrClosed();
    }
    _state = State.Closed;

    emit StateUpdated(_state);
  }

  function setRound(uint256 sPrice_, uint256 lPrice_, uint256 supply_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (isInactive()) {
      revert ErrClosed();
    }
    _rounds.push(
      Round({ defined: true, state: State.None, sPrice: sPrice_, lPrice: lPrice_, sold: 0, supply: supply_})
    );

    emit RoundAdded(sPrice_, lPrice_, supply_);
  }

  function setRefRate(uint256 firstRefRate_, uint256 secondRefRate_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (isInactive()) {
      revert ErrClosed();
    }
    if (firstRefRate_ > 1000) {
      revert ErrFirstRefFunds(firstRefRate_);
    }
    if (secondRefRate_ > 1000) {
      revert ErrSecondRefFunds(secondRefRate_);
    }
    _firstRefRate = firstRefRate_;
    _secondRefRate = secondRefRate_;

    emit RefRateSetup(_firstRefRate, _secondRefRate);
  }

  function setupReferrals(address[] calldata refs_, uint256[] calldata firstRefRate_, uint256[] calldata secodRefFunds_)
    external onlyRole(OPERATOR_ROLE)
  {
    if (isInactive()) {
      revert ErrClosed();
    }
    if (refs_.length != firstRefRate_.length || refs_.length != secodRefFunds_.length) {
      revert ErrParamsInvalid();
    }
    for (uint256 index = 0; index < refs_.length; index++) {
      _refs[refs_[index]] = Referral({
        defined: true,
        enabled: true,
        firstRefRate: firstRefRate_[index],
        secondRefRate: secodRefFunds_[index]
      });

      emit ReferralSetup(refs_[index], firstRefRate_[index], secodRefFunds_[index]);
    }
  }

  function updateRoundPrice(uint256 index_, uint256 sPrice_, uint256 lPrice_) 
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (isInactive()) {
      revert ErrClosed();
    } 
    if (!_rounds[index_].defined) {
       revert ErrRoundUndefined(index_);
    }
    if (_rounds[index_].state != State.None) {
      revert ErrRoundStarted(index_);
    }
    _rounds[index_].sPrice = sPrice_;
    _rounds[index_].lPrice = lPrice_;

    emit RoundPriceUpdated(index_, sPrice_, lPrice_);
  }

  function updateRoundSupply(uint256 index_, uint256 supply_) 
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (isInactive()) {
      revert ErrClosed();
    }
    if (!_rounds[index_].defined) {
      revert ErrRoundUndefined(index_);
    }
    if (_rounds[index_].state == State.Closed) {
      revert ErrRoundClosed(index_);
    }
    if (_rounds[index_].sold > supply_) {
      revert ErrRoundSupply(index_);
    }
    _rounds[index_].supply = supply_;

    emit RoundSupplyUpdated(index_, supply_);
  }

  function openRound(uint256 index_)
    external onlyRole(OPERATOR_ROLE)
  {
    if (!isActive()) {
      revert ErrClosed();
    }
    if (!_rounds[index_].defined) {
      revert ErrRoundUndefined(index_);
    }
    if (_rounds[index_].state != State.None) {
      revert ErrRoundStarted(index_);
    }
    if (_rounds[_currentRound].state == State.Opened) {
      _rounds[_currentRound].state = State.Closed;
    }
    _rounds[index_].state = State.Opened;
    _currentRound = index_;

    emit RoundOpened(index_);
  }

  function closeRound(uint256 index_)
    external onlyRole(OPERATOR_ROLE)
  {
    if (!_rounds[index_].defined) {
      revert ErrRoundUndefined(index_);
    }
    if (_rounds[index_].state != State.Opened) {
      revert ErrRoundClosed(index_);
    }
    _rounds[index_].state = State.Closed;

    emit RoundClosed(index_);
  }

  function setAuth(address user_, bool value_)
    external onlyRole(OPERATOR_ROLE)
  {
    _auth[user_] = value_;

    emit AuthUserUpdated(user_, value_);
  }

  function setAuthBatch(address[] calldata users_, bool[] calldata values_)
    external onlyRole(OPERATOR_ROLE)
  {
    if (users_.length != values_.length) {
      revert ErrParamsInvalid();
    }
    for (uint256 index = 0; index < users_.length; index++) {
      _auth[users_[index]] = values_[index];

      emit AuthUserUpdated(users_[index], values_[index]);
    }
  }

  function setMax(uint256 amount_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (amount_ > MAX) {
      revert ErrMax(amount_, MAX);
    }
    if (amount_ < _min) {
      revert ErrMin(amount_, _min);
    }
    _max = amount_;

    emit MaxUpdated(_max);
  }

  function setMin(uint256 amount_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (amount_ < MIN) {
      revert ErrMin(amount_, MIN);
    }
    if (amount_ > _max) {
      revert ErrMax(amount_, _max);
    }
    _min = amount_;

    emit MinUpdated(_min);
  }

  function setAuthLimit(uint256 amount_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (_min > amount_ || amount_ > _max) {
      revert ErrAuthLimit(amount_, _min, _max);
    }
    _authLimit = amount_;

    emit AuthLimitUpdated(amount_);
  }

  function setTreasury(address treasury_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (treasury_ == address(0)) {
      revert ErrNullAddress();
    }
    _treasury = treasury_;

    emit TreasuryUpdated(_treasury);
  }

  function setState(address user_, address token_, uint256 amount_, uint256 sold_, address ref_, uint256 fReward_, uint256 sReward_)
    external onlyRole(OPERATOR_ROLE)
  {
    _funds[user_] = _funds[user_] + amount_;
    _totalSold = _totalSold + sold_;
    _rounds[_currentRound].sold = _rounds[_currentRound].sold + sold_;
    _balances[user_][_currentRound] = _balances[user_][_currentRound] + sold_;

    if (ref_ != address(0)) {
      if (!_refs[ref_].defined) {
        _refs[ref_].defined = true;
        _refs[ref_].enabled = true;

        emit ReferralSetup(ref_, _firstRefRate, _secondRefRate);
      }
      _refsBalances[ref_][token_] += fReward_;
      _refsBalances[ref_][TOKEN] += sReward_;
      _refsUsers[user_] = ref_;  
    }
  }

  function enableReferral(address ref_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (!_refs[ref_].defined) {
      revert ErrRefUndefined(ref_);
    }
    if (_refs[ref_].enabled) {
      revert ErrRefEnabled(ref_);
    }
    _refs[ref_].enabled = true;

    emit ReferralEnabled(ref_);
  }

  function disableReferral(address ref_)
    external onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (!_refs[ref_].defined) {
      revert ErrRefUndefined(ref_);
    }
    if (!_refs[ref_].enabled) {
      revert ErrRefDisabled(ref_);
    }
    _refs[ref_].enabled = false;

    emit ReferralDisabled(ref_);
  }

  function claimRef(address[] calldata tokens_)
    external nonReentrant()
  {
    address ref_ = _msgSender();
    if (tokens_.length == 0) {
      revert ErrTokenUndefined();
    }
    if (!_refs[ref_].defined) {
      revert ErrRefUndefined(ref_);
    }
    if (!_refs[ref_].enabled) {
      revert ErrRefDisabled(ref_);
    }

    for (uint256 i = 0; i < tokens_.length; i++) {
      address token = tokens_[i];
      uint256 balance = _refsBalances[ref_][token];
      if (balance == 0) { continue; }

      _refsBalances[ref_][token] = 0;
      if (token == ETH) {        
        (bool success, ) = ref_.call{value: balance}('');
        if (!success) revert ErrTransfer();
      } else {
        IERC20(token).safeTransfer(ref_, balance);
      }

      emit ClaimedFunds(ref_, token, balance);
    }
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

  function getTreasury() external view returns (address) {
    return _treasury;
  }

  function getMax() external view returns (uint256) {
    return _max;
  }

  function getMin() external view returns (uint256) {
    return _min;
  }

  function getRoundsCount() external view returns (uint256) {
    return _rounds.length;
  }

  function getCurrentRound() external view returns (uint256) {
    return _currentRound;
  }

  function getRound(uint256 index_) external view  returns (Round memory) {
    return _rounds[index_];
  }

  function getTotalSold() external view returns (uint256) {
    return _totalSold;
  }

  function balanceOf(uint256 round_, address user_) external view returns (uint256) {
    return _balances[user_][round_];
  }

  function refBalanceOf(address token_, address user_) external view returns (uint256) {
    return _refsBalances[user_][token_];
  }

  function limitOf(address user_) external view returns (uint256) {
    uint256 amount = _funds[user_];
    uint256 limit = _authLimit;
    if (isAuth(user_)) {
      limit = _max;
    }
    return amount < limit ? limit - amount : 0;
  }

  function maxLimitOf(address user_) external view returns (uint256) {
    uint256 amount = _funds[user_];
    return amount < _max ? _max - amount : 0;
  }

  function getAuthLimit() external view returns (uint256) {
    return _authLimit;
  }

  function getRefRates() external view returns (uint256, uint256) {
    return (_firstRefRate, _secondRefRate);
  }

  function getRef(address user_, address ref_) external view returns (address) {
    Referral memory ref = _refs[_refsUsers[user_]];
    if (ref.defined && ref.enabled) {
      return _refsUsers[user_];
    }
    ref = _refs[ref_];
    if (!ref.defined || ref.enabled) {
      return ref_;
    }
    return address(0);
  }

  function getRefRates(address ref_) external view returns (uint256, uint256) {
    Referral memory ref = _refs[ref_];
    if (ref.defined) {
      return (Math.max(ref.firstRefRate, _firstRefRate), Math.max(ref.secondRefRate, _secondRefRate));
    }
    return (_firstRefRate, _secondRefRate);
  }

  function isActive() public view returns (bool) {
    return _state == State.Opened;
  }

  function isInactive() public view returns (bool) {
    return _state == State.Closed;
  }

  function getPrice(Option option_) public view returns (uint256) {
    if (_rounds[_currentRound].state == State.Opened) {
      return option_ == Option.Short ? _rounds[_currentRound].sPrice : _rounds[_currentRound].lPrice;
    }
    return 0;
  }

  function isAuth(address user_) public view returns (bool) {
    return _auth[user_];
  }

  receive() external payable { }
}