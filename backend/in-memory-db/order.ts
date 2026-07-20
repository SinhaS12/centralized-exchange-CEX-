

interface OrderEntry {
    userid: number,
    volume: number,
    amount: number
}



interface OrderBook {
    bids: {
        [amount:number]:OrderEntry[];
    },
    asks: {
        [amount:number]:OrderEntry[];
    },
    latestTrade: number

}
interface Order {
    [stockName: string]: OrderBook
}




const order: Order = {};


