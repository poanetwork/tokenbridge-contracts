require('dotenv').config()
const Web3 = require('web3')
const { newImplementation } = require('./constants')
const multiSigWalletAbi = require('../abi/multiSigwallet')
const proxyAbi = require('../../build/contracts/EternalStorageProxy').abi
const confirmTransaction = require('./confirmTransaction')

const { HOME_PRIVKEY, HOME_RPC_URL, HOME_BRIDGE_ADDRESS, ROLE, HOME_START_BLOCK, HOME_GAS_PRICE } = process.env

const web3 = new Web3(new Web3.providers.HttpProvider(HOME_RPC_URL))
const { address } = web3.eth.accounts.wallet.add(HOME_PRIVKEY)

const proxy = new web3.eth.Contract(proxyAbi, HOME_BRIDGE_ADDRESS)

const upgradeBridgeOnHome = async () => {
  try {
    const ownerAddress = await proxy.methods.upgradeabilityOwner().call()
    const multiSigWallet = new web3.eth.Contract(multiSigWalletAbi, ownerAddress)
    const data = proxy.methods.upgradeTo('3', newImplementation.xDaiBridge).encodeABI()

    if (ROLE === 'leader') {
      const gas = await multiSigWallet.methods
        .submitTransaction(HOME_BRIDGE_ADDRESS, 0, data)
        .estimateGas({ from: address })
      const receipt = await multiSigWallet.methods
        .submitTransaction(HOME_BRIDGE_ADDRESS, 0, data)
        .send({ from: address, gas, gasPrice: HOME_GAS_PRICE })
      console.log(receipt)
    } else {
      await confirmTransaction({
        fromBlock: HOME_START_BLOCK,
        contract: multiSigWallet,
        destination: HOME_BRIDGE_ADDRESS,
        data,
        address,
        gasPrice: HOME_GAS_PRICE
      })
    }
  } catch (e) {
    console.log(e.message)
  }
}

upgradeBridgeOnHome()
