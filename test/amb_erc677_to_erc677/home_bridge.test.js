const HomeAMBErc677ToErc677 = artifacts.require('HomeAMBErc677ToErc677.sol')
const HomeAMBErc677ToErc677RelativeDailyLimit = artifacts.require('HomeAMBErc677ToErc677RelativeDailyLimit.sol')
const EternalStorageProxy = artifacts.require('EternalStorageProxy.sol')
const ForeignAMBErc677ToErc677 = artifacts.require('ForeignAMBErc677ToErc677.sol')
const ForeignAMBErc677ToErc677RelativeDailyLimit = artifacts.require('ForeignAMBErc677ToErc677RelativeDailyLimit.sol')
const ERC677BridgeToken = artifacts.require('ERC677BridgeToken.sol')
const HomeAMB = artifacts.require('HomeAMB.sol')
const AMBMock = artifacts.require('AMBMock.sol')
const BridgeValidators = artifacts.require('BridgeValidators.sol')

const { expect } = require('chai')
const { shouldBehaveLikeBasicAMBErc677ToErc677 } = require('./AMBErc677ToErc677Behavior.test')

const { ether } = require('../helpers/helpers')
const { getEvents, expectEventInLogs } = require('../helpers/helpers')
const { ERROR_MSG, toBN } = require('../setup')

const ZERO = toBN(0)
const oneEther = ether('1')
const twoEthers = ether('2')
const maxGasPerTx = oneEther
const dailyLimit = twoEthers
const maxPerTx = oneEther
const minPerTx = ether('0.01')
const executionDailyLimit = dailyLimit
const executionMaxPerTx = maxPerTx
const executionMinPerTx = minPerTx
const exampleTxHash = '0xf308b922ab9f8a7128d9d7bc9bce22cd88b2c05c8213f0e2d8104d78e0a9ecbb'
const decimalShiftZero = 0
const targetLimit = ether('0.05')
const threshold = ether('10000')

function test(accounts, isRelativeDailyLimit) {
  const ForeignContract = isRelativeDailyLimit ? ForeignAMBErc677ToErc677RelativeDailyLimit : ForeignAMBErc677ToErc677
  const HomeContract = isRelativeDailyLimit ? HomeAMBErc677ToErc677RelativeDailyLimit : HomeAMBErc677ToErc677
  const owner = accounts[0]
  const user = accounts[1]
  let ambBridgeContract
  let mediatorContract
  let erc677Token
  let homeBridge

  let limitsArray = [dailyLimit, maxPerTx, minPerTx]
  if (isRelativeDailyLimit) {
    limitsArray = [targetLimit, threshold, maxPerTx, minPerTx]
  }

  beforeEach(async function() {
    this.bridge = await HomeContract.new()
    const storageProxy = await EternalStorageProxy.new().should.be.fulfilled
    await storageProxy.upgradeTo('1', this.bridge.address).should.be.fulfilled
    this.proxyContract = await HomeContract.at(storageProxy.address)
  })
  shouldBehaveLikeBasicAMBErc677ToErc677(HomeContract, accounts, isRelativeDailyLimit, true)
  describe('onTokenTransfer', () => {
    beforeEach(async () => {
      const validatorContract = await BridgeValidators.new()
      const authorities = [accounts[1], accounts[2]]
      await validatorContract.initialize(1, authorities, owner)
      ambBridgeContract = await HomeAMB.new()
      await ambBridgeContract.initialize(validatorContract.address, maxGasPerTx, '1', '1', owner)
      mediatorContract = await ForeignContract.new()
      erc677Token = await ERC677BridgeToken.new('test', 'TST', 18)
      await erc677Token.mint(user, twoEthers, { from: owner }).should.be.fulfilled

      homeBridge = await HomeContract.new()
      await homeBridge.initialize(
        ambBridgeContract.address,
        mediatorContract.address,
        erc677Token.address,
        limitsArray,
        [executionDailyLimit, executionMaxPerTx, executionMinPerTx],
        maxGasPerTx,
        decimalShiftZero,
        owner
      ).should.be.fulfilled
    })
    if (!isRelativeDailyLimit) {
      it('should emit UserRequestForSignature in AMB bridge and burn transferred tokens', async () => {
        // Given
        const currentDay = await homeBridge.getCurrentDay()
        expect(await homeBridge.totalSpentPerDay(currentDay)).to.be.bignumber.equal(ZERO)
        const initialEvents = await getEvents(ambBridgeContract, { event: 'UserRequestForSignature' })
        expect(initialEvents.length).to.be.equal(0)
        expect(await erc677Token.totalSupply()).to.be.bignumber.equal(twoEthers)

        // only token address can call it
        await homeBridge.onTokenTransfer(user, oneEther, '0x00', { from: owner }).should.be.rejectedWith(ERROR_MSG)

        // must be within limits
        await erc677Token
          .transferAndCall(homeBridge.address, twoEthers, '0x00', { from: user })
          .should.be.rejectedWith(ERROR_MSG)

        // When
        const { logs } = await erc677Token.transferAndCall(homeBridge.address, oneEther, '0x00', { from: user }).should.be
          .fulfilled

        // Then
        const events = await getEvents(ambBridgeContract, { event: 'UserRequestForSignature' })
        expect(events.length).to.be.equal(1)
        expect(await homeBridge.totalSpentPerDay(currentDay)).to.be.bignumber.equal(oneEther)
        expect(await erc677Token.totalSupply()).to.be.bignumber.equal(oneEther)
        expectEventInLogs(logs, 'Burn', {
          burner: homeBridge.address,
          value: oneEther
        })
      })
    }
  })
  describe('handleBridgedTokens', () => {
    const nonce = '0x96b6af865cdaa107ede916e237afbedffa5ed36bea84c0e77a33cc28fc2e9c01'
    beforeEach(async () => {
      ambBridgeContract = await AMBMock.new()
      await ambBridgeContract.setMaxGasPerTx(maxGasPerTx)
      mediatorContract = await ForeignContract.new()
      erc677Token = await ERC677BridgeToken.new('test', 'TST', 18)

      homeBridge = await HomeContract.new()
      await homeBridge.initialize(
        ambBridgeContract.address,
        mediatorContract.address,
        erc677Token.address,
        limitsArray,
        [executionDailyLimit, executionMaxPerTx, executionMinPerTx],
        maxGasPerTx,
        decimalShiftZero,
        owner
      ).should.be.fulfilled
      await erc677Token.transferOwnership(homeBridge.address)
    })
    it('should mint tokens on message from amb', async () => {
      // Given
      const currentDay = await homeBridge.getCurrentDay()
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(ZERO)
      const initialEvents = await getEvents(erc677Token, { event: 'Mint' })
      expect(initialEvents.length).to.be.equal(0)
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(ZERO)

      // can't be called by user
      await homeBridge.handleBridgedTokens(user, oneEther, nonce, { from: user }).should.be.rejectedWith(ERROR_MSG)
      // can't be called by owner
      await homeBridge.handleBridgedTokens(user, oneEther, nonce, { from: owner }).should.be.rejectedWith(ERROR_MSG)

      const data = await homeBridge.contract.methods.handleBridgedTokens(user, oneEther.toString(), nonce).encodeABI()

      // message must be generated by mediator contract on the other network
      const failedTxHash = '0x2ebc2ccc755acc8eaf9252e19573af708d644ab63a39619adb080a3500a4ff2e'

      await ambBridgeContract.executeMessageCall(homeBridge.address, owner, data, failedTxHash, 1000000).should.be
        .fulfilled

      expect(await ambBridgeContract.messageCallStatus(failedTxHash)).to.be.equal(false)

      await ambBridgeContract.executeMessageCall(
        homeBridge.address,
        mediatorContract.address,
        data,
        exampleTxHash,
        1000000
      ).should.be.fulfilled

      expect(await ambBridgeContract.messageCallStatus(exampleTxHash)).to.be.equal(true)

      // Then
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(oneEther)
      const events = await getEvents(erc677Token, { event: 'Mint' })
      expect(events.length).to.be.equal(1)
      expect(events[0].returnValues.to).to.be.equal(user)
      expect(events[0].returnValues.amount).to.be.equal(oneEther.toString())
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(oneEther)
      expect(await erc677Token.balanceOf(user)).to.be.bignumber.equal(oneEther)
    })
    it('should mint tokens on message from amb with decimal shift of two', async () => {
      // Given
      const decimalShiftTwo = 2
      erc677Token = await ERC677BridgeToken.new('test', 'TST', 18)

      homeBridge = await HomeContract.new()
      await homeBridge.initialize(
        ambBridgeContract.address,
        mediatorContract.address,
        erc677Token.address,
        limitsArray,
        [executionDailyLimit, executionMaxPerTx, executionMinPerTx],
        maxGasPerTx,
        decimalShiftTwo,
        owner
      ).should.be.fulfilled
      await erc677Token.transferOwnership(homeBridge.address)

      const currentDay = await homeBridge.getCurrentDay()
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(ZERO)
      const initialEvents = await getEvents(erc677Token, { event: 'Mint' })
      expect(initialEvents.length).to.be.equal(0)
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(ZERO)

      const valueOnForeign = toBN('1000')
      const valueOnHome = toBN(valueOnForeign * 10 ** decimalShiftTwo)

      const data = await homeBridge.contract.methods
        .handleBridgedTokens(user, valueOnForeign.toString(), nonce)
        .encodeABI()

      // message must be generated by mediator contract on the other network
      const failedTxHash = '0x2ebc2ccc755acc8eaf9252e19573af708d644ab63a39619adb080a3500a4ff2e'

      await ambBridgeContract.executeMessageCall(homeBridge.address, owner, data, failedTxHash, 1000000).should.be
        .fulfilled

      expect(await ambBridgeContract.messageCallStatus(failedTxHash)).to.be.equal(false)

      await ambBridgeContract.executeMessageCall(
        homeBridge.address,
        mediatorContract.address,
        data,
        exampleTxHash,
        1000000
      ).should.be.fulfilled

      expect(await ambBridgeContract.messageCallStatus(exampleTxHash)).to.be.equal(true)

      // Then
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(valueOnForeign)
      const events = await getEvents(erc677Token, { event: 'Mint' })
      expect(events.length).to.be.equal(1)
      expect(events[0].returnValues.to).to.be.equal(user)
      expect(events[0].returnValues.amount).to.be.equal(valueOnHome.toString())
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(valueOnHome)
      expect(await erc677Token.balanceOf(user)).to.be.bignumber.equal(valueOnHome)
    })
    it('should emit AmountLimitExceeded and not mint tokens when out of execution limits', async () => {
      // Given
      const currentDay = await homeBridge.getCurrentDay()
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(ZERO)
      const initialEvents = await getEvents(erc677Token, { event: 'Mint' })
      expect(initialEvents.length).to.be.equal(0)
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(ZERO)

      const outOfLimitValueData = await homeBridge.contract.methods
        .handleBridgedTokens(user, twoEthers.toString(), nonce)
        .encodeABI()

      // when
      await ambBridgeContract.executeMessageCall(
        homeBridge.address,
        mediatorContract.address,
        outOfLimitValueData,
        exampleTxHash,
        1000000
      ).should.be.fulfilled

      expect(await ambBridgeContract.messageCallStatus(exampleTxHash)).to.be.equal(true)

      // Then
      expect(await homeBridge.totalExecutedPerDay(currentDay)).to.be.bignumber.equal(ZERO)
      const events = await getEvents(erc677Token, { event: 'Mint' })
      expect(events.length).to.be.equal(0)
      expect(await erc677Token.totalSupply()).to.be.bignumber.equal(ZERO)
      expect(await erc677Token.balanceOf(user)).to.be.bignumber.equal(ZERO)

      expect(await homeBridge.outOfLimitAmount()).to.be.bignumber.equal(twoEthers)
      const outOfLimitEvent = await getEvents(homeBridge, { event: 'AmountLimitExceeded' })
      expect(outOfLimitEvent.length).to.be.equal(1)
      expect(outOfLimitEvent[0].returnValues.recipient).to.be.equal(user)
      expect(outOfLimitEvent[0].returnValues.value).to.be.equal(twoEthers.toString())
      expect(outOfLimitEvent[0].returnValues.transactionHash).to.be.equal(exampleTxHash)
    })
  })
}

contract('HomeAMBErc677ToErc677', async accounts => {
  test(accounts, false)
})

contract('HomeAMBErc677ToErc677RelativeDailyLimit', async accounts => {
  test(accounts, true)
})