pragma solidity 0.4.24;

import "../../libraries/Message.sol";
import "../../upgradeability/EternalStorage.sol";
import "../../interfaces/IBlockReward.sol";
import "../BasicHomeBridge.sol";
import "../ERC677Bridge.sol";
import "../OverdrawManagement.sol";
import "./RewardableHomeBridgeErcToNative.sol";

contract HomeBridgeErcToNative is EternalStorage, BasicHomeBridge, OverdrawManagement, RewardableHomeBridgeErcToNative {
    event AmountLimitExceeded(address recipient, uint256 value, bytes32 transactionHash);

    function() public payable {
        nativeTransfer();
    }

    function nativeTransfer() internal {
        require(msg.value > 0);
        require(msg.data.length == 0);
        require(withinLimit(msg.value));
        IBlockReward blockReward = blockRewardContract();
        uint256 totalMinted = blockReward.mintedTotallyByBridge(address(this));
        uint256 totalBurnt = totalBurntCoins();
        require(msg.value <= totalMinted.sub(totalBurnt));
        setTotalSpentPerDay(getCurrentDay(), totalSpentPerDay(getCurrentDay()).add(msg.value));
        uint256 valueToTransfer = msg.value;
        address feeManager = feeManagerContract();
        uint256 valueToBurn = msg.value;
        if (feeManager != address(0)) {
            uint256 fee = calculateFee(valueToTransfer, false, feeManager, HOME_FEE);
            valueToTransfer = valueToTransfer.sub(fee);
            valueToBurn = getAmountToBurn(valueToBurn);
        }
        setTotalBurntCoins(totalBurnt.add(valueToBurn));
        address(0).transfer(valueToBurn);
        emit UserRequestForSignature(msg.sender, valueToTransfer);
    }

    function initialize(
        address _validatorContract,
        uint256 _dailyLimit,
        uint256 _maxPerTx,
        uint256 _minPerTx,
        uint256 _homeGasPrice,
        uint256 _requiredBlockConfirmations,
        address _blockReward,
        uint256 _foreignDailyLimit,
        uint256 _foreignMaxPerTx,
        address _owner
    ) external returns (bool) {
        _initialize(
            _validatorContract,
            _dailyLimit,
            _maxPerTx,
            _minPerTx,
            _homeGasPrice,
            _requiredBlockConfirmations,
            _blockReward,
            _foreignDailyLimit,
            _foreignMaxPerTx,
            _owner
        );
        setInitialize();

        return isInitialized();
    }

    function rewardableInitialize(
        address _validatorContract,
        uint256 _dailyLimit,
        uint256 _maxPerTx,
        uint256 _minPerTx,
        uint256 _homeGasPrice,
        uint256 _requiredBlockConfirmations,
        address _blockReward,
        uint256 _foreignDailyLimit,
        uint256 _foreignMaxPerTx,
        address _owner,
        address _feeManager,
        uint256 _homeFee,
        uint256 _foreignFee
    ) external returns (bool) {
        _initialize(
            _validatorContract,
            _dailyLimit,
            _maxPerTx,
            _minPerTx,
            _homeGasPrice,
            _requiredBlockConfirmations,
            _blockReward,
            _foreignDailyLimit,
            _foreignMaxPerTx,
            _owner
        );
        require(AddressUtils.isContract(_feeManager));
        addressStorage[keccak256(abi.encodePacked("feeManagerContract"))] = _feeManager;
        _setFee(_feeManager, _homeFee, HOME_FEE);
        _setFee(_feeManager, _foreignFee, FOREIGN_FEE);
        setInitialize();

        return isInitialized();
    }

    function getBridgeMode() external pure returns (bytes4 _data) {
        return bytes4(keccak256(abi.encodePacked("erc-to-native-core")));
    }

    function blockRewardContract() public view returns (IBlockReward) {
        return IBlockReward(addressStorage[keccak256(abi.encodePacked("blockRewardContract"))]);
    }

    function totalBurntCoins() public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("totalBurntCoins"))];
    }

    function setBlockRewardContract(address _blockReward) external onlyOwner {
        require(AddressUtils.isContract(_blockReward));

        // Before store the contract we need to make sure that it is the block reward contract in actual fact,
        // call a specific method from the contract that should return a specific value
        bool isBlockRewardContract = false;
        if (_blockReward.call(abi.encodeWithSignature("blockRewardContractId()"))) {
            isBlockRewardContract =
                IBlockReward(_blockReward).blockRewardContractId() == bytes4(keccak256("blockReward"));
        } else if (_blockReward.call(abi.encodeWithSignature("bridgesAllowedLength()"))) {
            isBlockRewardContract = IBlockReward(_blockReward).bridgesAllowedLength() != 0;
        }
        require(isBlockRewardContract);
        addressStorage[keccak256(abi.encodePacked("blockRewardContract"))] = _blockReward;
    }

    function _initialize(
        address _validatorContract,
        uint256 _dailyLimit,
        uint256 _maxPerTx,
        uint256 _minPerTx,
        uint256 _homeGasPrice,
        uint256 _requiredBlockConfirmations,
        address _blockReward,
        uint256 _foreignDailyLimit,
        uint256 _foreignMaxPerTx,
        address _owner
    ) internal {
        require(!isInitialized());
        require(AddressUtils.isContract(_validatorContract));
        require(_requiredBlockConfirmations > 0);
        require(_minPerTx > 0 && _maxPerTx > _minPerTx && _dailyLimit > _maxPerTx);
        require(_blockReward == address(0) || AddressUtils.isContract(_blockReward));
        require(_foreignMaxPerTx < _foreignDailyLimit);
        require(_owner != address(0));
        addressStorage[keccak256(abi.encodePacked("validatorContract"))] = _validatorContract;
        uintStorage[keccak256(abi.encodePacked("deployedAtBlock"))] = block.number;
        uintStorage[DAILY_LIMIT] = _dailyLimit;
        uintStorage[MAX_PER_TX] = _maxPerTx;
        uintStorage[MIN_PER_TX] = _minPerTx;
        uintStorage[GAS_PRICE] = _homeGasPrice;
        uintStorage[REQUIRED_BLOCK_CONFIRMATIONS] = _requiredBlockConfirmations;
        addressStorage[keccak256(abi.encodePacked("blockRewardContract"))] = _blockReward;
        uintStorage[keccak256(abi.encodePacked("executionDailyLimit"))] = _foreignDailyLimit;
        uintStorage[keccak256(abi.encodePacked("executionMaxPerTx"))] = _foreignMaxPerTx;
        setOwner(_owner);
    }

    function onExecuteAffirmation(address _recipient, uint256 _value, bytes32 txHash) internal returns (bool) {
        setTotalExecutedPerDay(getCurrentDay(), totalExecutedPerDay(getCurrentDay()).add(_value));
        IBlockReward blockReward = blockRewardContract();
        require(blockReward != address(0));
        uint256 valueToMint = _value;

        address feeManager = feeManagerContract();
        if (feeManager != address(0)) {
            uint256 fee = calculateFee(valueToMint, false, feeManager, FOREIGN_FEE);
            distributeFeeFromAffirmation(fee, feeManager, txHash);
            valueToMint = valueToMint.sub(fee);
        }
        blockReward.addExtraReceiver(valueToMint, _recipient);
        return true;
    }

    function onSignaturesCollected(bytes _message) internal {
        address feeManager = feeManagerContract();
        if (feeManager != address(0)) {
            address recipient;
            uint256 amount;
            bytes32 txHash;
            address contractAddress;
            (recipient, amount, txHash, contractAddress) = Message.parseMessage(_message);
            uint256 fee = calculateFee(amount, true, feeManager, HOME_FEE);
            distributeFeeFromSignatures(fee, feeManager, txHash);
        }
    }

    function setTotalBurntCoins(uint256 _amount) internal {
        uintStorage[keccak256(abi.encodePacked("totalBurntCoins"))] = _amount;
    }

    function onFailedAffirmation(address _recipient, uint256 _value, bytes32 _txHash) internal {
        address recipient;
        uint256 value;
        (recipient, value) = txAboveLimits(_txHash);
        require(recipient == address(0) && value == 0);
        setOutOfLimitAmount(outOfLimitAmount().add(_value));
        setTxAboveLimits(_recipient, _value, _txHash);
        emit AmountLimitExceeded(_recipient, _value, _txHash);
    }
}
