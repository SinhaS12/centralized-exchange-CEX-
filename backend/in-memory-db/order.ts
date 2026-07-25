

export interface OrderEntry {
    userid: number,
    volume: number,
    amount: number
}



export interface OrderBook {
    bids: {
        [amount:number]:OrderEntry[];
    },
    asks: {
        [amount:number]:OrderEntry[];
    },
    latestTrade: number

}
export interface Order {
    [stockName: string]: OrderBook
}




export const order: Order = {};


