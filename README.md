# digital-banking-stock-market
This is my collage project
<br>
Author-Gagan Shrestha

## Project Structure

```text
digital banking system/
|-- server.js                 Express app and HTTP/WebSocket startup
|-- db.js                     MySQL connection pool
|-- controllers/              User, admin, and share business logic
|-- routes/                   API route definitions
|-- middleware/               Authentication middleware
|-- realtime/
|   `-- marketSocket.js       Authenticated live market-price broadcast
|-- public/
|   |-- index.html            User dashboard
|   |-- js/script.js          Dashboard actions and WebSocket client
|   `-- css/                  Dashboard and theme styles
`-- package.json              Node.js dependencies and scripts
```

## Live Market Updates

The user dashboard connects to `ws://localhost:3000/ws/market` after login. When a share admin updates a stock price, the server broadcasts a `market:price-updated` event and open Market Overview or Watchlist panels refresh automatically. The existing Refresh buttons remain available as a manual fallback.
