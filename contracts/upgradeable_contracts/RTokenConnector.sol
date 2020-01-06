pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/AddressUtils.sol";
import "../interfaces/IRToken.sol";
import "./Ownable.sol";
import "./ERC20Bridge.sol";

contract RTokenConnector is Ownable, ERC20Bridge {
    bytes32 internal constant RTOKEN = 0xdce7cb71f7466970418465f97f1fb7d721c1661bc59b1f0caa7d1f8ce374a47e; // keccak256(abi.encodePacked("rToken"))

    function initializeRToken(
        address _rToken,
        address[] _recipients,
        uint32[] _proportions
    ) external onlyOwner returns (uint256) {
        require(AddressUtils.isContract(_rToken));
        addressStorage[RTOKEN] = _rToken;
        return createAndChangeRTokenHat(_recipients, _proportions);
    }

    function removeRToken() external onlyOwner {
        addressStorage[RTOKEN] = address(0);
    }

    function redeemRToken(uint256 _redeemTokens) external onlyOwner {
        _redeemRToken(_redeemTokens);
    }

    function mintRToken(uint256 _mintAmount) public {
        address rTokenAddress = rToken();
        if (rTokenAddress == address(0)) return;
        erc20token().approve(rTokenAddress, _mintAmount);
        IRToken(rTokenAddress).mint(_mintAmount);
    }

    function createAndChangeRTokenHat(
        address[] _recipients,
        uint32[] _proportions
    ) public onlyOwner returns (uint256) {
        return IRToken(rToken()).createHat(_recipients, _proportions, true);
    }

    function rToken() public view returns (address) {
        return addressStorage[RTOKEN];
    }

    function _redeemRToken(uint256 _redeemTokens) internal {
        if (rToken() == address(0)) return;
        IRToken(rToken()).redeem(_redeemTokens);
    }
}
