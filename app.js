#!/usr/bin/env node
const config = require('config')
const api = require('binance')
const { Point } = require('@influxdata/influxdb-client')
const { InfluxDB } = require('@influxdata/influxdb-client')

const token = config.get('influxToken')
const org = config.get('influxOrg')
const bucket = config.get('influxBucket')

const client = new InfluxDB({ url: config.get('influxUrl'), token: token })

credentialsArray = config.get('users')

let timerId = setInterval(() => {
  for (let index in credentialsArray) {
    binanceRest = new api.BinanceRest({
      key: credentialsArray[index].apikey,
      secret: credentialsArray[index].secretkey,
      timeout: 15000,
      recvWindow: 10000,
      disableBeautification: false,
      baseUrl: 'https://api.binance.com/',
    })
    binanceRest.account().then(async (data) => {
      balances = await makeBalanceArray(data)
      totalBalances = await countBalances(balances)
      console.log(totalBalances)
      await writeToInflux(totalBalances, credentialsArray[index].chatid)
    })
  }
}, 30000)

async function makeBalanceArray(data) {
  balanceArray = []
  for (let i in data.balances) {
    if (
      parseFloat(data.balances[i].free) !== 0 ||
      parseFloat(data.balances[i].locked) !== 0
    ) {
      balanceArray.push({
        asset: data.balances[i].asset,
        count: +data.balances[i].free + +data.balances[i].locked,
      })
    }
  }
  return balanceArray
}

async function countBalances(balanceArray) {
  for (let i in balanceArray) {
    if (balanceArray[i].asset === 'BTC') {
      price = await binanceRest.tickerPrice('BTCUSDT')
      balanceArray[i].totalUSDT = (
        balanceArray[i].count * +price.price
      ).toFixed(4)
      balanceArray[i].totalBTC = balanceArray[i].count.toFixed(8)
    } else if (balanceArray[i].asset === 'USDT') {
      price = await binanceRest.tickerPrice('BTCUSDT')
      balanceArray[i].totalBTC = (balanceArray[i].count / +price.price).toFixed(
        8
      )
      balanceArray[i].totalUSDT = balanceArray[i].count.toFixed(4)
    } else {
      priceBTC = await binanceRest.tickerPrice(balanceArray[i].asset + 'BTC')
      balanceArray[i].totalBTC = (
        balanceArray[i].count * +priceBTC.price
      ).toFixed(8)
      try {
        priceUSDT = await binanceRest.tickerPrice(
          balanceArray[i].asset + 'USDT'
        )
        balanceArray[i].totalUSDT = (
          balanceArray[i].count * +priceUSDT.price
        ).toFixed(4)
      } catch (error) {
        btcPrice = await binanceRest.tickerPrice('BTCUSDT')
        balanceArray[i].totalUSDT = +balanceArray[i].totalBTC * +btcPrice.price
      }
    }
  }
  return balanceArray
}

async function writeToInflux(dataArray, chatId) {
  const writeApi = client.getWriteApi(org, bucket)
  allAssets = { inBTC: 0, inUSDT: 0 }
  for (let index in dataArray) {
    writeApi.useDefaultTags({ coin: dataArray[index].asset })
    const pointCount = new Point(chatId).floatField(
      'count',
      +dataArray[index].count
    )
    writeApi.writePoint(pointCount)

    const pointBTC = new Point(chatId).floatField(
      'inBTC',
      +dataArray[index].totalBTC
    )
    allAssets.inBTC += +dataArray[index].totalBTC
    writeApi.writePoint(pointBTC)

    const pointUSDT = new Point(chatId).floatField(
      'inUSDT',
      +dataArray[index].totalUSDT
    )
    allAssets.inUSDT += +dataArray[index].totalUSDT

    writeApi.writePoint(pointUSDT)

    writeApi
      .close()
      .then(() => {
        console.log('FINISHED')
      })
      .catch((e) => {
        console.error(e)
        console.log('\\nFinished ERROR')
      })
  }
  writeApi.useDefaultTags({ coin: 'All' })
  const AllinBTC = new Point(chatId).floatField('inBTC', +allAssets.inBTC)
  writeApi.writePoint(AllinBTC)

  const AllinUSDT = new Point(chatId).floatField('inUSDT', +allAssets.inUSDT)
  writeApi.writePoint(AllinUSDT)
  writeApi.close()
}
