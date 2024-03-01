// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract PriceAggregatorV3 {
  uint256 public timestamp;

  constructor() {
    timestamp = block.timestamp - 100;
  }

  function decimals() external pure returns (uint8) {
    return 8;
  }

  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    return (92233720368547776118, 250000000000, timestamp, timestamp, 92233720368547776118);
  }

  function setTimestamp(uint256 timestamp_)
    external
  {
    timestamp = timestamp_;
  }
}
