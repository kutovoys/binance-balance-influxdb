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
  try {
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
        totalBalances = await getPrices(balances)
        await writeToInflux(totalBalances, credentialsArray[index].chatid)
      })
    }
  } catch (error) {
    console.error(error)
  }
}, 5000)

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

async function getPrices(dataArray) {
  prices = await binanceRest.tickerPrice()
  for (let index in dataArray) {
    if (dataArray[index].asset === 'BTC') {
      for (let i in prices) {
        if (prices[i].symbol === 'BTCUSDT') {
          dataArray[index].totalUSDT = (
            dataArray[index].count * +prices[i].price
          ).toFixed(4)
          dataArray[index].totalBTC = dataArray[index].count.toFixed(8)
          dataArray[index].priceUSDT = (+prices[i].price).toFixed(4)
          dataArray[index].priceBTC = (+prices[i].price).toFixed(8)
          BTCPrice = prices[i].price
        }
      }
    } else if (dataArray[index].asset === 'USDT') {
      for (let i in prices) {
        if (prices[i].symbol === 'BTCUSDT') {
          dataArray[index].totalUSDT = dataArray[index].count.toFixed(4)
          dataArray[index].totalBTC = (
            dataArray[index].count / +prices[i].price
          ).toFixed(8)
          dataArray[index].priceUSDT = (+prices[i].price).toFixed(4)
          dataArray[index].priceBTC = (+prices[i].price).toFixed(8)
        }
      }
    } else {
      for (let i in prices) {
        if (dataArray[index].asset + 'USDT' === prices[i].symbol) {
          dataArray[index].priceUSDT = (+prices[i].price).toFixed(4)
          dataArray[index].totalUSDT = (
            +prices[i].price * dataArray[index].count
          ).toFixed(4)
        } else if (dataArray[index].asset + 'BTC' === prices[i].symbol) {
          dataArray[index].priceBTC = (+prices[i].price).toFixed(8)
          dataArray[index].totalBTC = (
            +prices[i].price * dataArray[index].count
          ).toFixed(8)
        }
      }
    }
    if (!('priceBTC' in dataArray[index] && 'priceUSDT' in dataArray[index])) {
      dataArray[index].priceUSDT = (
        BTCPrice * +dataArray[index].priceBTC
      ).toFixed(4)
      dataArray[index].totalUSDT = (
        +dataArray[index].priceUSDT * dataArray[index].count
      ).toFixed(4)
    }
  }
  return dataArray
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

    const pointPriceBTC = new Point(chatId).floatField(
      'priceBTC',
      +dataArray[index].priceBTC
    )
    writeApi.writePoint(pointPriceBTC)

    const pointUSDT = new Point(chatId).floatField(
      'inUSDT',
      +dataArray[index].totalUSDT
    )
    allAssets.inUSDT += +dataArray[index].totalUSDT

    writeApi.writePoint(pointUSDT)

    const pointPriceUSDT = new Point(chatId).floatField(
      'priceUSDT',
      +dataArray[index].priceUSDT
    )
    writeApi.writePoint(pointPriceUSDT)
  }
  writeApi.useDefaultTags({ coin: 'All' })
  const AllinBTC = new Point(chatId).floatField('inBTC', +allAssets.inBTC)
  writeApi.writePoint(AllinBTC)

  const AllinUSDT = new Point(chatId).floatField('inUSDT', +allAssets.inUSDT)
  writeApi.writePoint(AllinUSDT)
  await writeApi.close()
}
