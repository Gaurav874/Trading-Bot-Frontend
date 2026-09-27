import { useEffect, useState } from "react";
import axios from "axios";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

import "./App.css";

const API = "https://trading-bot-ssb5.onrender.com";
const symbol = "AAPL";

// ==========================================
// DATE FORMATTER
// ==========================================

const formatChartDate = (date) => {
  const d = new Date(date);

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  });
};

function App() {
  const [strategy, setStrategy] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [history, setHistory] = useState([]);

  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isTrading, setIsTrading] = useState(false);
  const [tradeType, setTradeType] = useState("");

  // ==========================================
  // LOAD DATA
  // ==========================================

  const loadData = async () => {
    try {
      const [
        strategyRes,
        portfolioRes,
        tradesRes,
        historyRes
      ] = await Promise.all([
        axios.get(`${API}/api/strategy/${symbol}`),
        axios.get(`${API}/api/portfolio`),
        axios.get(`${API}/api/trades`),
        axios.get(`${API}/api/stock/${symbol}/history`)
      ]);

      setStrategy(strategyRes.data);
      setPortfolio(portfolioRes.data);
      setTrades(tradesRes.data.trades);

      // ==========================================
      // PRICE CHART DATA
      // ==========================================

      const chartData = historyRes.data.values
        .slice()
        .reverse()
        .map((item) => ({
          date: item.datetime,
          price: Number(item.close)
        }));

      setHistory(chartData);
      setLastUpdated(new Date());

    } catch (error) {
      console.error("Failed to load data:", error);
    }
  };

  // ==========================================
  // BUY / SELL
  // ==========================================

const handleTrade = async (type) => {
  try {
    setMessage("");

    if (!strategy) {
      setMessage("Strategy data is not available");
      return;
    }

    const price = Number(strategy.currentPrice);
    const tradeQuantity = Number(quantity);

    if (!tradeQuantity || tradeQuantity <= 0) {
      setMessage("Quantity must be greater than 0");
      return;
    }

    // Start loading only after validation
    setIsTrading(true);
    setTradeType(type);

    // ==========================================
    // SEND TRADE TO BACKEND
    // ==========================================

    const response = await axios.post(
      `${API}/api/trade/${type}`,
      {
        symbol,
        quantity: tradeQuantity,
        price
      }
    );

    // ==========================================
    // SHOW SUCCESS
    // ==========================================

    setMessage(response.data.message);

    // ==========================================
    // UPDATE TRADE HISTORY IMMEDIATELY
    // ==========================================

    if (response.data.trade) {
      setTrades((prevTrades) => [
        response.data.trade,
        ...prevTrades
      ]);
    }

    // ==========================================
    // UPDATE PORTFOLIO IMMEDIATELY
    // ==========================================

    setPortfolio((prevPortfolio) => {
      if (!prevPortfolio || !response.data.trade) {
        return prevPortfolio;
      }

      const trade = response.data.trade;

      const updatedHoldings = [
        ...prevPortfolio.holdings
      ];

      const holdingIndex = updatedHoldings.findIndex(
        (item) => item.symbol === trade.symbol
      );

      // BUY
      if (type === "buy") {
        if (holdingIndex !== -1) {
          const oldHolding =
            updatedHoldings[holdingIndex];

          const oldQuantity =
            Number(oldHolding.quantity);

          const oldAveragePrice =
            Number(oldHolding.averagePrice);

          const newQuantity =
            oldQuantity + trade.quantity;

          const newAveragePrice =
            (
              oldQuantity * oldAveragePrice +
              trade.quantity * trade.price
            ) / newQuantity;

          updatedHoldings[holdingIndex] = {
            ...oldHolding,
            quantity: newQuantity,
            averagePrice: newAveragePrice,
            currentPrice: price,
            investedValue:
              newQuantity * newAveragePrice,
            currentValue:
              newQuantity * price,
            profitLoss:
              newQuantity * price -
              newQuantity * newAveragePrice
          };
        } else {
          updatedHoldings.push({
            symbol: trade.symbol,
            quantity: trade.quantity,
            averagePrice: trade.price,
            currentPrice: price,
            investedValue:
              trade.quantity * trade.price,
            currentValue:
              trade.quantity * price,
            profitLoss: 0
          });
        }
      }

      // SELL
      if (type === "sell") {
        if (holdingIndex !== -1) {
          const oldHolding =
            updatedHoldings[holdingIndex];

          const remainingQuantity =
            Number(oldHolding.quantity) -
            trade.quantity;

          if (remainingQuantity <= 0) {
            updatedHoldings.splice(holdingIndex, 1);
          } else {
            const averagePrice =
              Number(oldHolding.averagePrice);

            updatedHoldings[holdingIndex] = {
              ...oldHolding,
              quantity: remainingQuantity,
              currentPrice: price,
              investedValue:
                remainingQuantity * averagePrice,
              currentValue:
                remainingQuantity * price,
              profitLoss:
                remainingQuantity * price -
                remainingQuantity * averagePrice
            };
          }
        }
      }

      // RECALCULATE PORTFOLIO

      const balance =
        type === "buy"
          ? Number(prevPortfolio.balance) -
            Number(trade.totalValue)
          : Number(prevPortfolio.balance) +
            Number(trade.totalValue);

      const investedValue =
        updatedHoldings.reduce(
          (total, holding) =>
            total + Number(holding.investedValue),
          0
        );

      const currentValue =
        updatedHoldings.reduce(
          (total, holding) =>
            total + Number(holding.currentValue),
          0
        );

      const totalProfitLoss =
        currentValue - investedValue;

      return {
        ...prevPortfolio,
        balance,
        investedValue,
        currentValue,
        totalProfitLoss,
        totalPortfolioValue:
          balance + currentValue,
        holdings: updatedHoldings
      };
    });

    // ==========================================
    // BACKGROUND SYNC
    // ==========================================

    Promise.all([
      axios.get(`${API}/api/portfolio`),
      axios.get(`${API}/api/trades`)
    ])
      .then(([portfolioRes, tradesRes]) => {
        setPortfolio(portfolioRes.data);
        setTrades(tradesRes.data.trades);
        setLastUpdated(new Date());
      })
      .catch((error) => {
        console.error(
          "Background refresh failed:",
          error
        );
      });

  } catch (error) {
    setMessage(
      error.response?.data?.message ||
      "Trade failed"
    );
  } finally {
    setIsTrading(false);
    setTradeType("");
  }
};

  // ==========================================
  // INITIAL LOAD + AUTO REFRESH
  // ==========================================

  useEffect(() => {
    loadData();

    const interval = setInterval(() => {
      loadData();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // ==========================================
  // LOADING
  // ==========================================

  // if (!strategy || !portfolio) {
  //   return <h2 className="loading">Loading Trading Bot...</h2>;
  // }
  if (!strategy || !portfolio) {
  return (
    <div className="loading-screen">
      <div className="loader-content">

        <div className="chart-loader">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>

        <h2>Trading Bot</h2>

        <p>
          Fetching market data
          <span className="dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>

        <div className="loading-bar">
          <div className="loading-progress"></div>
        </div>

      </div>
    </div>
  );
}

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="app">

      <h1>📈 Trading Bot Dashboard</h1>

      {/* ======================================
          LAST UPDATED
      ====================================== */}

      {lastUpdated && (
        <p className="last-updated">
          Last Updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}

      {/* ======================================
          SUMMARY CARDS
      ====================================== */}

      <div className="cards">

        <div className="card">
          <h3>Virtual Balance</h3>
          <p>
            ${Number(portfolio.balance).toFixed(2)}
          </p>
        </div>

        <div className="card">
          <h3>Portfolio Value</h3>
          <p>
            ${Number(portfolio.totalPortfolioValue).toFixed(2)}
          </p>
        </div>

        <div className="card">
          <h3>Total P/L</h3>
          <p>
            ${Number(portfolio.totalProfitLoss).toFixed(2)}
          </p>
        </div>

      </div>

      {/* ======================================
          STRATEGY
      ====================================== */}

      <div className="section">

        <h2>{symbol} Strategy</h2>

        <div className="strategy">

          <div>
            <strong>Current Price</strong>
            <p>
              ${Number(strategy.currentPrice).toFixed(2)}
            </p>
          </div>

          <div>
            <strong>EMA 9</strong>
            <p>
              {Number(strategy.ema9).toFixed(2)}
            </p>
          </div>

          <div>
            <strong>EMA 21</strong>
            <p>
              {Number(strategy.ema21).toFixed(2)}
            </p>
          </div>

          <div>
            <strong>RSI</strong>
            <p>
              {Number(strategy.rsi).toFixed(2)}
            </p>
          </div>

          <div>
            <strong>Signal</strong>

            <p
              className={`signal ${strategy.signal.toLowerCase()}`}
            >
              {strategy.signal}
            </p>
          </div>

        </div>

        {/* ====================================
            BUY / SELL CONTROLS
        ==================================== */}

        <div className="trade-controls">

          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />


<div className="trade-actions">

  <button
    className="buy-button"
    onClick={() => handleTrade("buy")}
    disabled={isTrading}
    aria-label="Buy"
  >
    {isTrading && tradeType === "buy" ? (
      <span className="button-spinner"></span>
    ) : (
      "BUY"
    )}
  </button>

  <button
    className="sell-button"
    onClick={() => handleTrade("sell")}
    disabled={isTrading}
    aria-label="Sell"
  >
    {isTrading && tradeType === "sell" ? (
      <span className="button-spinner"></span>
    ) : (
      "SELL"
    )}
  </button>

</div>

{/* 👇 BUY/SELL buttons ke neeche */}
{isTrading && (
  <div className="trade-loading">
    <span className="trade-spinner"></span>
  </div>
)}

        </div>

        {/* ====================================
            TRADE ALERT
        ==================================== */}

        {message && (
          <div className="trade-alert">
            ✓ {message}
          </div>
        )}

      </div>

      {/* ======================================
          PRICE CHART
      ====================================== */}

      <div className="section">

        <h2>{symbol} Price Chart</h2>

        <div className="chart-container">

          <ResponsiveContainer width="100%" height="100%">

            <LineChart
              data={history}
              margin={{
                top: 10,
                right: 15,
                left: 5,
                bottom: 5
              }}
            >

              <CartesianGrid strokeDasharray="3 3" />

              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={{ fontSize: 13 }}
                minTickGap={35}
              />

              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 13 }}
              />

              <Tooltip
                labelFormatter={(value) =>
                  new Date(value).toLocaleDateString(
                    "en-GB",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    }
                  )
                }
                formatter={(value) => [
                  `$${Number(value).toFixed(2)}`,
                  "Price"
                ]}
              />

              <Line
                type="monotone"
                dataKey="price"
                stroke="#2563eb"
                dot={false}
                strokeWidth={2}
              />

            </LineChart>

          </ResponsiveContainer>

        </div>

      </div>

      {/* ======================================
          HOLDINGS
      ====================================== */}

      <div className="section">

        <h2>Holdings</h2>

        {portfolio.holdings.length === 0 ? (

          <p>No holdings</p>

        ) : (

          <div className="holdings">

            {portfolio.holdings.map((holding) => (

              <div
                className="holding"
                key={holding.symbol}
              >

                <div className="holding-symbol">
                  {holding.symbol}
                </div>

                <div className="holding-info">

                  <div>
                    <span>Quantity</span>
                    <strong>
                      {holding.quantity}
                    </strong>
                  </div>

                  <div>
                    <span>Avg Price</span>
                    <strong>
                      ${Number(holding.averagePrice).toFixed(2)}
                    </strong>
                  </div>

                  <div>
                    <span>Current Price</span>
                    <strong>
                      $
                      {holding.symbol === symbol
                        ? Number(strategy.currentPrice).toFixed(2)
                        : Number(holding.currentPrice).toFixed(2)}
                    </strong>
                  </div>

                  <div>
                    <span>P/L</span>

                    <strong
                      className={
                        Number(holding.profitLoss) >= 0
                          ? "profit"
                          : "loss"
                      }
                    >
                      ${Number(holding.profitLoss).toFixed(2)}
                    </strong>
                  </div>

                </div>

              </div>

            ))}

          </div>

        )}

      </div>

      {/* ======================================
          TRADE HISTORY
      ====================================== */}

      <div className="section">

        <h2>Trade History</h2>

        {trades.length === 0 ? (

          <p>No trades yet</p>

        ) : (

          <div className="trade-history">

            {trades.map((trade) => (

              <div
                className="trade"
                key={trade._id}
              >

                <strong
                  className={
                    trade.type === "BUY"
                      ? "buy"
                      : "sell"
                  }
                >
                  {trade.type}
                </strong>

                <span>
                  {trade.symbol}
                </span>

                <span>
                  {trade.quantity} × $
                  {Number(trade.price).toFixed(2)}
                </span>

                <span>
                  P/L: $
                  {Number(trade.profitLoss).toFixed(2)}
                </span>

              </div>

            ))}

          </div>

        )}

      </div>

      {/* ======================================
          REFRESH
      ====================================== */}

      <button
        className="refresh-button"
        onClick={loadData}
      >
        🔄 Refresh Data
      </button>

    </div>
  );
}

export default App;