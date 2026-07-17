

interface OrderEntry {
    userid: number,
    volume: number,
    amount: number
}

interface OrderBook {
    bids: OrderEntry[],
    asks: OrderEntry[],
    latestTrade: number

}
interface Order {
    [stockName: string]: OrderBook
}




const order: Order = {};


/* 
Again wahi question why array and not object 
as array need iteration and object does not need that it need keys;


why bids and asks in object or array explain 
*/