import { CeloContract } from '@celo/contractkit'
import { DappKitRequestTypes, DappKitResponseStatus } from '@celo/utils'
import { MiniRpcProvider } from 'connectors/NetworkConnector'
import { requestValoraTransaction } from './valoraUtils'

/**
 * Subprovider for interfacing with a user's Valora wallet.
 */
export class ValoraProvider extends MiniRpcProvider {
  // constructor(chainId: number, url: string, batchWaitTimeMs?: number) {
  //   super(chainId, url, batchWaitTimeMs)
  // }

  _networkRequest = this.request

  _request = async (method: string, params?: unknown[] | object): Promise<unknown> => {
    console.log('[Valora request]', { method, params })
    if (method === 'eth_estimateGas' && params) {
      try {
        const txData = (params as unknown[])[0] as { from: string; to: string; data: string }
        const baseNonce = await this.kit.connection.nonce(txData.from)
        const stableAddress = await this.kit.registry.addressFor(CeloContract.StableToken)
        // estimate gas for the transaction
        const gasEstimate = await this.kit.connection.estimateGas({
          feeCurrency: stableAddress,
          nonce: baseNonce,
          ...txData
        })
        return '0x' + gasEstimate.toString(16)
      } catch (e) {
        console.error('Failed to estimate gas', { method, params }, e)
        throw e
      }
    } else if (method === 'eth_sendTransaction' && params) {
      const txParams = params as readonly { gas: string; from: string; to: string; data: string }[]
      const [firstTx] = txParams
      if (!firstTx) {
        throw new Error('No tx found')
      }
      const stableAddress = await this.kit.registry.addressFor(CeloContract.StableToken)
      // const goldAddress = await this.kit.registry.addressFor(CeloContract.GoldToken)
      const baseNonce = await this.kit.connection.nonce(firstTx.from)

      try {
        const txs = await Promise.all(
          txParams.map(async ({ from, to, data }, i) => {
            const gasEstimate = await this.kit.connection.estimateGas({
              feeCurrency: stableAddress,
              from,
              to,
              data
            })
            return {
              txData: data,
              estimatedGas: gasEstimate,
              from,
              to,
              nonce: baseNonce + i,
              feeCurrencyAddress: stableAddress,
              value: '0'
            }
          })
        )
        console.debug('Sending txs', txs)
        const resp = await requestValoraTransaction(txs)
        if (resp.type === DappKitRequestTypes.SIGN_TX && resp.status === DappKitResponseStatus.SUCCESS) {
          const tx = await this.kit.web3.eth.sendSignedTransaction(resp.rawTxs[0])
          console.log('Valora TX sent', tx)
          return tx.transactionHash
          // const result = await Promise.all(
          //   resp.rawTxs.map(async rawTx => {
          //     return await toTxResult(this.kit.web3.eth.sendSignedTransaction(rawTx)).waitReceipt()
          //   })
          // )
          // return result
        }
      } catch (e) {
        console.error('[Valora] Failed to send transaction', { method, params }, e)
        throw e
      }
    }
    return await this._networkRequest.call(this, method, params)
  }

  request = async (
    method: string | { method: string; params: unknown[] },
    params?: unknown[] | object
  ): Promise<unknown> => {
    if (typeof method !== 'string') {
      return this._request(method.method, method.params)
    }
    return this._request(method, params)
  }
}
