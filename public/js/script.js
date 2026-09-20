function showScreen(screenId) {
    if (screenId === 'dashboard' && !currentUser) {
        screenId = 'login-section';
    }
    document.querySelectorAll('#app > div').forEach(div => {
        div.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');

    if (screenId === 'dashboard') {
        // When showing dashboard, apply theme from localStorage
        if (localStorage.getItem('user_theme') === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        showDashboardPanel('main-view');
    } else {
        // For any other screen (login, register, etc.), remove dark mode
        document.body.classList.remove('dark-mode');
    }
}

async function fetchSharePrice() {
    const symbol = document.getElementById('share-symbol').value.toUpperCase();
    if (!symbol) return alert("Please enter a symbol (e.g., NICA, NABIL)");
    
    try {
        const res = await fetch(`/api/share-admin/stocks/price/${symbol}`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            document.getElementById('share-details-card').classList.remove('hidden');
            document.getElementById('res-symbol').innerText = data.symbol;
            document.getElementById('res-price').innerText = parseFloat(data.current_price).toFixed(2);
            const buyButton = document.getElementById('buy-share-btn');
            const buyStatus = document.getElementById('buy-share-status');
            buyButton.disabled = !data.can_buy;
            buyButton.style.opacity = data.can_buy ? '1' : '0.55';
            buyButton.title = data.can_buy ? 'Buy this share' : 'Buying is unavailable after the closing date';
            buyStatus.textContent = data.can_buy ? '' : 'Buying is unavailable because this share is not currently open.';
            buyStatus.classList.toggle('hidden', data.can_buy);
        } else {
            const err = await res.json();
            alert(err.message);
            document.getElementById('share-details-card').classList.add('hidden');
        }
    } catch (error) {
        console.error("Error fetching share price:", error);
        alert("Could not fetch share price. Please try again.");
        document.getElementById('share-details-card').classList.add('hidden');
    }
}
async function processTrade(action) {
    if (action === 'buy' && document.getElementById('buy-share-btn').disabled) {
        return alert('This share is not currently open for buying.');
    }
    const symbol = document.getElementById('res-symbol').innerText;
    const price = parseFloat(document.getElementById('res-price').innerText);
    const quantity = parseInt(document.getElementById('trade-qty').value);

    if (isNaN(quantity) || quantity <= 0) return alert("Please enter valid units");

    const totalCost = quantity * price;
    if (action === 'buy' && totalCost > (Number(currentUser.trading_balance) || 0)) {
        return alert("Insufficient trading balance. Add funds to your trading wallet first.");
    }

    const endpoint = action === 'buy' ? '/api/buy-share' : '/api/sell-share';
    
    const res = await fetch(endpoint, {
        credentials: 'include',
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ symbol, quantity, price }),
    });
    const result = await res.json();
    alert(result.message);

    if (res.ok) {
        await refreshCurrentUser();
        updateUI();
        loadTradingWallet();
        loadPortfolio(); 
        document.getElementById('trade-qty').value = "";
    }
}
async function loadPortfolio() {
    const res = await fetch('/api/portfolio', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    const portfolio = await res.json();
    const tableBody = document.getElementById('portfolio-table-body');
    
    if (portfolio.length > 0) {
        tableBody.innerHTML = portfolio.map(item => `
            ${(() => {
                const avgPrice = Number(item.average_price) || 0;
                const currentPrice = Number(item.current_price) || 0;
                const quantity = Number(item.quantity) || 0;
                const investment = avgPrice * quantity;
                const currentValue = currentPrice * quantity;
                const pnl = currentValue - investment;
                const previousPrice = Number(item.previous_price);
                const hasPreviousPrice = Number.isFinite(previousPrice);
                const marketChange = hasPreviousPrice ? currentPrice - previousPrice : 0;
                const recentPnl = marketChange * quantity;
                const pnlClass = pnl >= 0 ? 'profit' : 'loss';
                const pnlSign = pnl >= 0 ? '+' : '';
                const marketChangeClass = marketChange >= 0 ? 'profit' : 'loss';
                const marketChangeSign = marketChange >= 0 ? '+' : '';
                const previousPriceDisplay = hasPreviousPrice ? `Rs. ${previousPrice.toFixed(2)}` : 'N/A';
                const marketChangeDisplay = hasPreviousPrice ? `${marketChangeSign}Rs. ${marketChange.toFixed(2)}` : 'N/A';
                const recentPnlDisplay = hasPreviousPrice ? `${marketChange >= 0 ? '+' : ''}Rs. ${recentPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A';

                return `
                    <tr>
                        <td>${item.company_name || 'N/A'}</td>
                        <td>${item.symbol}</td>
                        <td>${quantity}</td>
                        <td>Rs. ${avgPrice.toFixed(2)}</td>
                        <td> ${previousPriceDisplay}</td>
                        <td>Rs. ${currentPrice.toFixed(2)}</td>
                        <td class="${marketChangeClass}">${marketChangeDisplay}</td>
                        <td>Rs. ${currentValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td class="${pnlClass}">${pnlSign}Rs. ${pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td class="${marketChangeClass}">${recentPnlDisplay}</td>
                        <td><button onclick="sellFromPortfolio('${item.symbol}', ${quantity})" class="action-btn-red" style="padding: 2px 10px; font-size: 12px; cursor: pointer;">Sell</button></td>
                    </tr>`;
            })()}
        `).join('');
    } else {
        tableBody.innerHTML = "<tr><td colspan='11'>No shares in portfolio.</td></tr>";
    }
}
function sellFromPortfolio(symbol, maxQty) {
    const sellQtyStr = prompt(`How many units of ${symbol} do you want to sell? (Max: ${maxQty})`);
    if (sellQtyStr === null) return; // User cancelled

    const sellQty = parseInt(sellQtyStr);
    if (isNaN(sellQty) || sellQty <= 0 || sellQty > maxQty) return alert("Invalid quantity");

    // Fetch the current market price first
    fetch(`/api/share-admin/stocks/price/${symbol}`, { credentials: 'include' })
    .then(res => {
        if (!res.ok) throw new Error('Could not fetch current price.');
        return res.json();
    })
    .then(data => {
        const currentMarketPrice = parseFloat(data.current_price).toFixed(2);
        if (confirm(`The current market price for ${symbol} is Rs. ${currentMarketPrice}.\n\nProceed to sell ${sellQty} units?`)) {
            document.getElementById('res-symbol').innerText = symbol;
            document.getElementById('res-price').innerText = currentMarketPrice;
            document.getElementById('trade-qty').value = sellQty;
            processTrade('sell');
        }
    })
    .catch(err => {
        alert(`Error: ${err.message} Could not complete the sell order.`);
    });
}

function oldSellFromPortfolio(symbol, maxQty) {
    const qty = prompt(`How many units of ${symbol} do you want to sell? (Max: ${maxQty})`);
    if (qty === null) return;
    
    const sellQty = parseInt(qty);
    if (isNaN(sellQty) || sellQty <= 0 || sellQty > maxQty) {
        return alert("Invalid quantity");
    }

    const currentMarketPrice = (Math.random() * (1000 - 100) + 100).toFixed(2);
    
    if (confirm(`Selling ${sellQty} units of ${symbol} at Rs. ${currentMarketPrice}. Proceed?`)) {
        document.getElementById('res-symbol').innerText = symbol;
        document.getElementById('res-price').innerText = currentMarketPrice;
        document.getElementById('trade-qty').value = sellQty;
        processTrade('sell');
    }
}

function switchAsbaTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.asba-tab-content').forEach(el => el.classList.add('hidden'));
    // Deactivate all tab buttons
    document.querySelectorAll('#my-asba-section .tab-btn').forEach(btn => btn.classList.remove('active-tab'));
    
    // Show the target tab content
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.remove('hidden');
    
    // Activate the clicked tab button
    const activeBtn = Array.from(document.querySelectorAll('#my-asba-section .tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (activeBtn) activeBtn.classList.add('active-tab');
}

async function openShareResult() {
    showDashboardPanel('share-result-section');
    const table = document.getElementById('standalone-result-table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Company</th>
                <th>Applied Units</th>
                <th>Allotted Units</th>
                <th>Status</th>
                <th>Refund Amount</th>
            </tr>
        </thead>
        <tbody>
            <tr><td colspan="5" style="text-align:center; padding: 15px;">Loading results...</td></tr>
        </tbody>`;

    const res = await fetch('/api/asba/my-applications', { credentials: 'include' });
    if (res.ok) {
        const applications = await res.json();
        const results = applications.filter(app => app.status === 'Allotted' || app.status === 'Not Allotted');
        const tableBody = table.querySelector('tbody');

        if (results.length > 0) {
            tableBody.innerHTML = results.map(app => {
                const refundAmount = (app.applied_units - (app.allotted_units || 0)) * app.price_per_unit;
                return `
                    <tr>
                        <td>${app.company_name}</td>
                        <td>${app.applied_units}</td>
                        <td>${app.allotted_units || 0}</td>
                        <td><span class="status-badge" style="background-color: ${app.status === 'Allotted' ? '#27ae60' : '#e74c3c'};">${app.status}</span></td>
                        <td>Rs. ${refundAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>`;
            }).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 15px;">No allotment results available yet.</td></tr>';
        }
    }
}

async function openMyAsba() {
    showDashboardPanel('my-asba-section');
    switchAsbaTab('asba-apply-tab'); // Show the first tab by default

    // Fetch and display user's applications for "Application Report" tab
    const applicationsRes = await fetch('/api/asba/my-applications', { credentials: 'include' });
    if (applicationsRes.ok) {
        const applications = await applicationsRes.json();
        const applicationsBody = document.getElementById('asba-my-applications-body');
        const resultsBody = document.getElementById('asba-results-body');

        // Filter for allotment results
        const allotmentResults = applications.filter(app => app.status === 'Allotted' || app.status === 'Not Allotted');

        if (applications.length > 0) {
            applicationsBody.innerHTML = applications.map(app => `
                <tr>
                    <td>${new Date(app.applied_at).toLocaleDateString('en-GB')}</td>
                    <td>${app.company_name}</td>
                    <td>${app.applied_units}</td>
                    <td><span class="status-badge" style="background-color: ${app.status === 'Allotted' ? '#27ae60' : (app.status === 'Not Allotted' ? '#e74c3c' : '#f39c12')};">${app.status}</span></td>
                </tr>
            `).join('');
        } else {
            applicationsBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px;">You have not applied for any shares yet.</td></tr>';
        }

        // Populate the Allotment Result tab
        if (allotmentResults.length > 0) {
            resultsBody.innerHTML = allotmentResults.map(app => `
                <tr>
                    <td>${app.company_name}</td>
                    <td>${app.applied_units}</td>
                    <td>${app.allotted_units || 0}</td>
                    <td><span class="status-badge" style="background-color: ${app.status === 'Allotted' ? '#27ae60' : (app.status === 'Not Allotted' ? '#e74c3c' : '#f39c12')};">${app.status}</span></td>
                </tr>
            `).join('');
        } else {
            resultsBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px;">No allotment results available yet.</td></tr>';
        }

        // Fetch open and upcoming issues, and use the application data to show "Edit" button
        const appliedOfferingIds = new Set(applications.map(app => app.offering_id));

        // Fetch and display OPEN offerings for "Apply for Issue" tab
        const offeringsRes = await fetch('/api/asba/offerings', { credentials: 'include' });
        if (offeringsRes.ok) {
            const offerings = await offeringsRes.json();
            const issuesBody = document.getElementById('asba-open-issues-body');
            if (offerings.length > 0) {
                issuesBody.innerHTML = offerings.map(o => {
                    const hasApplied = appliedOfferingIds.has(o.id);
                    const buttonHtml = hasApplied
                        ? `<button onclick="applyForShare(${o.id}, '${o.symbol}', ${o.price_per_unit}, '${o.company_name}')" class="action-btn-blue" style="padding: 5px 10px; width: auto;">Edit</button>`
                        : `<button onclick="applyForShare(${o.id}, '${o.symbol}', ${o.price_per_unit}, '${o.company_name}')" class="action-btn-green" style="padding: 5px 10px; width: auto;">Apply Now</button>`;
                    
                    return `
                        <tr>
                            <td>${o.company_name}</td>
                            <td>${o.symbol}</td>
                            <td>Rs. ${parseFloat(o.price_per_unit).toFixed(2)}</td>
                            <td>${new Date(o.close_date).toLocaleDateString('en-GB')}</td>
                            <td>${buttonHtml}</td>
                        </tr>`;
                }).join('');
            } else {
                issuesBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 15px;">No issues are open for application right now.</td></tr>';
            }
        }

        // Fetch and display UPCOMING offerings for "Current Issue" tab
        const upcomingRes = await fetch('/api/asba/upcoming-offerings', { credentials: 'include' });
        if (upcomingRes.ok) {
            const upcoming = await upcomingRes.json();
            const upcomingBody = document.getElementById('asba-upcoming-issues-body');
            upcomingBody.innerHTML = upcoming.length > 0 ? upcoming.map(o => `
                <tr><td>${o.company_name}</td><td>${o.symbol}</td><td>${new Date(o.open_date).toLocaleDateString('en-GB')}</td><td>${new Date(o.close_date).toLocaleDateString('en-GB')}</td></tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; padding: 15px;">There are no upcoming issues.</td></tr>';
        }
    }
}

function calculateApplyAmount() {
    const units = parseInt(document.getElementById('apply-units').value) || 0;
    const price = parseFloat(document.getElementById('apply-price').textContent) || 0;
    const totalAmount = units * price;
    document.getElementById('apply-total-amount').value = `Rs. ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function applyForShare(offeringId, symbol, price, companyName) {
    // Show the application panel instead of prompts
    showDashboardPanel('share-application-panel');

    // Populate the form with share details
    document.getElementById('apply-company-name').textContent = companyName;
    document.getElementById('apply-symbol').textContent = symbol;
    document.getElementById('apply-price').textContent = parseFloat(price).toFixed(2);

    // Clear previous inputs
    document.getElementById('apply-units').value = '';
    document.getElementById('apply-pin').value = '';
    calculateApplyAmount(); // Reset total amount display

    // Store the offeringId in the confirm button so we can retrieve it later
    document.getElementById('confirm-apply-btn').dataset.offeringId = offeringId;
}

async function confirmShareApplication() {
    const offeringId = document.getElementById('confirm-apply-btn').dataset.offeringId;
    const appliedUnits = parseInt(document.getElementById('apply-units').value);
    const pin = document.getElementById('apply-pin').value;
    const price = parseFloat(document.getElementById('apply-price').textContent);

    if (isNaN(appliedUnits) || appliedUnits < 10) {
        return alert("Invalid input. Please apply for at least 10 units.");
    }

    const totalAmount = appliedUnits * price;
    if (totalAmount > currentUser.balance) {
        return alert(`Insufficient balance. You need Rs. ${totalAmount.toLocaleString()} but you only have Rs. ${parseFloat(currentUser.balance).toLocaleString()}.`);
    }

    if (pin === null || pin.length !== 4) {
        return alert("Invalid Transaction PIN.");
    }

    const res = await fetch('/api/asba/apply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            offeringId: parseInt(offeringId),
            units: appliedUnits,
            pin: pin
        })
    });

    const result = await res.json();
    alert(result.message); // Show the final result in a popup

    if (res.ok) {
        await checkLoginStatus(); // Re-fetch user data to update balance
        openMyAsba(); // Go back to the ASBA section and reload it
    }
}


async function checkLoginStatus() {
    try {
        // Attempt to fetch the session from the server
        const res = await fetch('/api/check-session', { credentials: 'include' });

        if (res.ok) {
            const { user } = await res.json();
            if (user) {
                
                currentUser = user;

                if (currentUser.role === 'admin') {
                    window.location.href = '/admin-panel';
                    return;
                }
                if (currentUser.role === 'share_admin') {
                    window.location.href = '/share-admin-panel';
                    return;
                }

                updateUI();
                fetchDashboardData();
                showScreen('dashboard');
            }
        } else {
           
            currentUser = null;
            showScreen('login-section');
        }
    } catch (error) {
        console.error('Session check failed:', error);
        showScreen('login-section'); 
    }
}
let currentUser = null;
let isBalanceHidden = false;
let marketSocket;

function connectMarketSocket() {
    if (marketSocket && marketSocket.readyState <= 1) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    marketSocket = new WebSocket(`${protocol}//${window.location.host}/ws/market`);
    marketSocket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'market:price-updated') {
            if (!document.getElementById('market-overview-section')?.classList.contains('hidden')) loadMarketOverview();
            if (!document.getElementById('watchlist-section')?.classList.contains('hidden')) loadWatchlist();
            if (!document.getElementById('share-market-section')?.classList.contains('hidden')) loadPortfolio();
        }
    };
    marketSocket.onclose = () => { marketSocket = null; setTimeout(connectMarketSocket, 5000); };
}

connectMarketSocket();
function showDashboardPanel(panelId) {
    const sidebar = document.querySelector('.sidebar');

    document.querySelectorAll('#dash-main > div').forEach(div => {
        div.classList.add('hidden');
    });

    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.remove('hidden');
    }

    // Control sidebar visibility based on the panel being shown
    if (panelId === 'main-view') {
        sidebar.classList.add('hidden');
    } else {
        sidebar.classList.remove('hidden');
    }

    // Special load functions for specific panels
    if (panelId === 'share-market-section') {
        loadPortfolio();
        loadTradingWallet();
    }
    if (panelId === 'trading-wallet-section') {
        loadTradingWallet();
    }
    if (panelId === 'market-overview-section') {
        loadMarketOverview();
    }
    if (panelId === 'watchlist-section') {
        loadWatchlist();
    }
    if (panelId === 'my-asba-section') {
        openMyAsba();
    }
}

async function loadWatchlist() {
    const grid = document.getElementById('watchlist-grid');
    if (!grid) return;
    grid.innerHTML = '<p class="market-loading">Loading watchlist...</p>';
    try {
        const response = await fetch('/api/watchlist', { credentials: 'include' });
        if (!response.ok) throw new Error('Watchlist unavailable');
        const shares = await response.json();
        grid.innerHTML = shares.length ? shares.map(renderWatchlistShare).join('') :
            '<p class="market-loading">Your watchlist is empty. Add a listed share above.</p>';
    } catch (error) {
        console.error('Error loading watchlist:', error);
        grid.innerHTML = '<p class="market-loading">Could not load watchlist. Please try again.</p>';
    }
}

function renderWatchlistShare(stock) {
    const movement = Number(stock.change) >= 0 ? 'up' : 'down';
    const sign = Number(stock.change) >= 0 ? '+' : '';
    return `
        <article class="market-stock-card watchlist-stock-card">
            <div class="market-stock-topline"><span class="market-symbol">${escapeMarketText(stock.symbol)}</span><span class="market-company">${escapeMarketText(stock.name)}</span></div>
            <div class="market-price-row"><strong>Rs. ${Number(stock.current_price).toFixed(2)}</strong><span class="market-change ${movement}">${sign}${Number(stock.change).toFixed(2)}%</span></div>
            <div class="watchlist-stock-footer"><span>Current market price</span><button class="watchlist-remove-btn" onclick="removeFromWatchlist('${escapeMarketText(stock.symbol)}')" title="Remove ${escapeMarketText(stock.symbol)}">Remove</button></div>
        </article>`;
}

async function addToWatchlist(event) {
    event.preventDefault();
    const input = document.getElementById('watchlist-symbol');
    const message = document.getElementById('watchlist-message');
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    try {
        const response = await fetch('/api/watchlist', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
        });
        const result = await response.json();
        message.textContent = result.message;
        message.className = `watchlist-message ${response.ok ? 'success' : 'error'}`;
        if (response.ok) { input.value = ''; loadWatchlist(); }
    } catch (error) {
        message.textContent = 'Could not update your watchlist.';
        message.className = 'watchlist-message error';
    }
}

async function removeFromWatchlist(symbol) {
    try {
        const response = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE', credentials: 'include' });
        const result = await response.json();
        const message = document.getElementById('watchlist-message');
        message.textContent = result.message;
        message.className = `watchlist-message ${response.ok ? 'success' : 'error'}`;
        if (response.ok) loadWatchlist();
    } catch (error) {
        console.error('Error removing watchlist item:', error);
    }
}

async function loadMarketOverview() {
    const grid = document.getElementById('market-stock-grid');
    const summary = document.getElementById('market-summary');
    if (!grid || !summary) return;

    grid.innerHTML = '<p class="market-loading">Loading market data...</p>';
    try {
        const response = await fetch('/api/share-admin/market-overview', { credentials: 'include' });
        if (!response.ok) throw new Error('Market data unavailable');
        const stocks = await response.json();
        const rising = stocks.filter(stock => stock.change > 0).length;
        const falling = stocks.filter(stock => stock.change < 0).length;
        summary.innerHTML = `
            <div><strong>${stocks.length}</strong><span>Listed shares</span></div>
            <div class="summary-up"><strong>${rising}</strong><span>Rising</span></div>
            <div class="summary-down"><strong>${falling}</strong><span>Falling</span></div>`;
        grid.innerHTML = stocks.length ? stocks.map(renderMarketStock).join('') :
            '<p class="market-loading">No listed shares are available yet.</p>';
    } catch (error) {
        console.error('Error loading market overview:', error);
        grid.innerHTML = '<p class="market-loading">Could not load market data. Please try again.</p>';
    }
}

function renderMarketStock(stock) {
    const values = stock.history.map(point => Number(point.price));
    const movement = stock.change >= 0 ? 'up' : 'down';
    const chart = createMarketChart(values, movement);
    const sign = stock.change >= 0 ? '+' : '';
    return `
        <article class="market-stock-card">
            <div class="market-stock-topline"><span class="market-symbol">${escapeMarketText(stock.symbol)}</span><span class="market-company">${escapeMarketText(stock.name)}</span></div>
            <div class="market-price-row"><strong>Rs. ${Number(stock.current_price).toFixed(2)}</strong><span class="market-change ${movement}">${sign}${Number(stock.change).toFixed(2)}%</span></div>
            <div class="market-chart" aria-label="${escapeMarketText(stock.symbol)} price trend">${chart}</div>
            <div class="market-range"><span>Recent trend</span><span>${stock.history.length} updates</span></div>
        </article>`;
}

function createMarketChart(values, movement) {
    const width = 360;
    const height = 120;
    const padding = 8;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
        const x = values.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (values.length - 1);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        return { x, y };
    });
    const segments = points.slice(1).map((point, index) => {
        const previousPoint = points[index];
        const color = values[index + 1] > values[index]
            ? '#18a66a'
            : values[index + 1] < values[index]
                ? '#df4d5d'
                : '#98a2b3';
        return `<line x1="${previousPoint.x.toFixed(1)}" y1="${previousPoint.y.toFixed(1)}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}" stroke="${color}" stroke-width="4" stroke-linecap="round" />`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="none">${segments}</svg>`;
}

function escapeMarketText(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function openCashDeposit() {
    showDashboardPanel('cash-deposit-section');
}

async function fetchDepositRecipientName() {
    const account = document.getElementById('deposit-recipient-account').value.trim();
    const name = document.getElementById('deposit-recipient-name');
    if (currentUser && account === String(currentUser.account_number)) {
        name.value = 'Cannot deposit to your own account';
        return;
    }
    if (account.length < 10) {
        name.value = '';
        return;
    }
    name.value = 'Fetching name...';
    try {
        const response = await fetch(`/api/user-by-account/${encodeURIComponent(account)}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Account not found');
        const user = await response.json();
        name.value = `${user.first_name} ${user.last_name}`;
    } catch (error) {
        name.value = 'Account not found';
    }
}

async function processDepositToAccount() {
    const recipientAccount = document.getElementById('deposit-recipient-account').value.trim();
    const recipientName = document.getElementById('deposit-recipient-name').value;
    const amount = Number(document.getElementById('deposit-to-account-amount').value);
    const remarks = document.getElementById('deposit-to-account-remarks').value.trim();
    const pin = document.getElementById('deposit-to-account-pin').value;
    if (currentUser && recipientAccount === String(currentUser.account_number)) {
        return alert('You cannot deposit to your own account. Enter another account number.');
    }
    if (!recipientAccount || !recipientName || recipientName === 'Account not found' || recipientName === 'Fetching name...' || recipientName === 'Cannot deposit to your own account') {
        return alert('Enter a valid recipient account first.');
    }
    if (!Number.isFinite(amount) || amount <= 0) return alert('Enter a valid amount.');
    if (!/^\d{4}$/.test(pin)) return alert('Enter your 4-digit transaction PIN.');
    if (!confirm(`Deposit Rs. ${amount.toLocaleString()} to ${recipientName}?`)) return;

    const response = await fetch('/api/deposit-to-account', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientAccount, amount, remarks, pin })
    });
    const result = await response.json();
    alert(result.message);
    if (!response.ok) return;
    currentUser.balance = result.newBalance;
    updateUI();
    document.getElementById('deposit-to-account-amount').value = '';
    document.getElementById('deposit-to-account-remarks').value = '';
    document.getElementById('deposit-to-account-pin').value = '';
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning,";
    if (hour < 18) return "Good Afternoon,";
    return "Good Evening,";
}
function toggleBalance() {
    const balElem = document.getElementById('display-balance');
    const accElem = document.getElementById('display-acc-no');
    const btn = document.getElementById('toggle-eye');
    
    isBalanceHidden = !isBalanceHidden;
    
    if (isBalanceHidden) {
        balElem.innerText = "******";
        accElem.innerText = "**********";
        btn.innerText = "🚫";
    } else {
       balElem.innerText = `Rs. ${parseFloat(currentUser.balance).toLocaleString()}`;
        accElem.innerText = currentUser.account_number;
        btn.innerText = "👁️";
    }
}
function toggleNotifications() {
    const dropdown = document.getElementById('noti-dropdown');
    if (currentUser && getSettingsPreferences().notifications === false) {
        dropdown.classList.add('hidden');
        return alert('In-app notifications are turned off in Settings.');
    }
    dropdown.classList.toggle('hidden');
    
    if (!dropdown.classList.contains('hidden') && currentUser) {
        fetch(`/api/notifications/mark-read`, {
            method: 'POST', 
            credentials: 'include'
        });
        document.getElementById('user-noti-count').classList.add('hidden');
    }
}
async function fetchDashboardData() {
    const res = await fetch(`/api/dashboard-data/${currentUser.id}`, { credentials: 'include' });
    const data = await res.json();
    const list = document.getElementById('noti-list');
    const countBadge = document.getElementById('user-noti-count');

    const fullRes = await fetch(`/api/notifications/${currentUser.id}`, { credentials: 'include' });
    const allNotis = await fullRes.json();

    const unreadCount = allNotis.filter(n => !n.is_read).length;
    if (unreadCount > 0 && getSettingsPreferences().notifications !== false) {
        countBadge.innerText = unreadCount;
        countBadge.classList.remove('hidden');
    } else {
        countBadge.classList.add('hidden');
    }

    if (data.notifications.length > 0) {
        list.innerHTML = data.notifications.map(n => `<div class="noti-item">${n.message}</div>`).join('');
    } else {
        list.innerHTML = "No new notifications";
    }
}
async function processChangePassword() {
    const oldPassword = document.getElementById('old-pass').value;
    const newPassword = document.getElementById('new-pass').value;
    const res = await fetch('/api/change-password', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
    });
    const result = await res.json();
    alert(result.message);
    if(res.ok) {
        document.getElementById('old-pass').value = '';
        document.getElementById('new-pass').value = '';
        openSettings();
    }
}

function settingsStorageKey() {
    return `bank-settings-${currentUser?.id || 'guest'}`;
}

function getSettingsPreferences() {
    try { return JSON.parse(localStorage.getItem(settingsStorageKey())) || { notifications: true }; }
    catch { return { notifications: true }; }
}

function saveSettingsPreferences(preferences) {
    localStorage.setItem(settingsStorageKey(), JSON.stringify(preferences));
}

function setThemePreference(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('user_theme', isDark ? 'dark' : 'light');
    const headerToggle = document.getElementById('dark-mode-toggle-user');
    const settingsToggle = document.getElementById('settings-dark-mode');
    if (headerToggle) headerToggle.checked = isDark;
    if (settingsToggle) settingsToggle.checked = isDark;
}

function setNotificationPreference(enabled) {
    const preferences = getSettingsPreferences();
    preferences.notifications = enabled;
    saveSettingsPreferences(preferences);
    document.getElementById('settings-notifications').checked = enabled;
    if (!enabled) {
        document.getElementById('noti-dropdown').classList.add('hidden');
        document.getElementById('user-noti-count').classList.add('hidden');
    }
}

function openSettings() {
    showDashboardPanel('settings-section');
    const preferences = getSettingsPreferences();
    document.getElementById('settings-dark-mode').checked = document.body.classList.contains('dark-mode');
    document.getElementById('settings-notifications').checked = preferences.notifications !== false;
}

async function processChangeTransactionPin() {
    const oldPin = document.getElementById('old-transaction-pin').value;
    const newPin = document.getElementById('new-transaction-pin').value;
    const confirmPin = document.getElementById('confirm-transaction-pin').value;
    if (!/^\d{4}$/.test(oldPin) || !/^\d{4}$/.test(newPin)) return alert('Please enter valid 4-digit PINs.');
    if (newPin !== confirmPin) return alert('New PIN and confirmation PIN do not match.');
    const response = await fetch('/api/change-transaction-pin', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPin, newPin })
    });
    const result = await response.json().catch(() => ({}));
    alert(result.message || 'Could not update transaction PIN.');
    if (response.ok) {
        ['old-transaction-pin', 'new-transaction-pin', 'confirm-transaction-pin'].forEach(id => document.getElementById(id).value = '');
        openSettings();
    }
}
async function uploadProfile(inputId = 'profile-upload') {
    const file = document.getElementById(inputId).files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        return alert('Please choose a PNG, JPEG, or WebP image smaller than 2 MB.');
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
        const base64String = reader.result;
        const res = await fetch('/api/update-profile', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64String }),
        });

        if (res.ok) {
            document.getElementById('header-profile-img').src = base64String;
            document.getElementById('welcome-profile-img').src = base64String;
            const pageImage = document.getElementById('profile-page-image');
            if (pageImage) pageImage.src = base64String;
            alert("Profile photo updated!");
            currentUser.profile_pic = base64String; 
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        } else {
            const result = await res.json().catch(() => ({}));
            alert(result.message || 'Could not update profile photo.');
        }
    };
    reader.readAsDataURL(file);
}
function updateUI() {
    if (!currentUser) return;
    document.getElementById('time-greeting').innerText = getGreeting();
    document.getElementById('user-full-name').innerText = `${currentUser.first_name} ${currentUser.last_name}`;
    document.getElementById('display-acc-no').innerText = currentUser.account_number;
    const bal = parseFloat(currentUser.balance) || 0;
    document.getElementById('display-balance').innerText = `Rs. ${bal.toLocaleString()}`;
    if (currentUser.profile_pic && currentUser.profile_pic !== 'null') { 
        document.getElementById('header-profile-img').src = currentUser.profile_pic;
        document.getElementById('welcome-profile-img').src = currentUser.profile_pic;
    }
}
async function resetPassword() {
    const phone = document.getElementById('forgot-phone').value;
    const newPassword = document.getElementById('forgot-new-pass').value;
    if (!phone || !newPassword) { 
        return alert("Please enter your phone number and new password.");
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(newPassword.trim())) {
        return alert("Password must be 8+ characters with a letter, a number, and a special character.");
    }

    const res = await fetch('/api/forgot-password/reset', { 
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, newPassword }),
    });
    const result = await res.json();
    alert(result.message);
    if (res.ok) showScreen('login-section');
}

function toggleLoginPasswordVisibility() {
    console.log("toggleLoginPasswordVisibility function called!"); // Debugging message
    const passwordInput = document.getElementById('login-pass');
    const toggleIcon = document.querySelector('#login-section .password-toggle-icon');

    if (!passwordInput || !toggleIcon) {
        console.error("Password input field or toggle icon not found in login section. Check HTML IDs/classes.");
        return;
    }

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.textContent = '🚫'; 
    } else {
        passwordInput.type = 'password';
        toggleIcon.textContent = '👁️'; 
    }
}

async function register() {
    const btn = document.getElementById('reg-btn');
    
    try {
        btn.disabled = true; 
        btn.innerText = "Registering...";

        const phoneElem = document.getElementById('phone');
        if (!phoneElem || !phoneElem.value) {
            throw new Error("Phone number is required");
        }

        const data = {
            firstName: document.getElementById('fname').value,
            lastName: document.getElementById('lname').value,
            dob: document.getElementById('dob').value,
            gender: document.getElementById('gender').value,
            phone: phoneElem.value.trim(),
            accType: document.querySelector('input[name="acc_type"]:checked').value,
            branch: document.getElementById('branch').value,
            password: document.getElementById('reg-pass').value.trim(),
            transPin: document.getElementById('trans_pin').value.trim()
        };

        const res = await fetch('/api/register', {
            credentials: 'include',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data),
        });

        const result = await res.json();
        alert(result.message);
        if(res.ok) showScreen('login-section');
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Submit";
    }
} 
async function login() {
    const phoneInput = document.getElementById('login-phone');
    const passInput = document.getElementById('login-pass');
    const btn = document.getElementById('login-btn');

    if (!phoneInput.value || !passInput.value) {
        return alert("Please fill in all fields.");
    }

    const phone = phoneInput.value.trim();
    const password = passInput.value.trim();

    btn.disabled = true;
    btn.innerText = "Logging in...";

    try {
        const res = await fetch('/api/login', {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone, password }),
        });

        // Response handle garnu vanda pailai JSON ho ki haina check garne
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await res.text();
            throw new Error("Server returned non-JSON response. Check console.");
        }

        const result = await res.json();

        if(res.ok) {
            if (result.user.role === 'admin') {
                window.location.href = '/admin-panel';
            } else if (result.user.role === 'share_admin') {
                window.location.href = '/share-admin-panel';
            } else {
                currentUser = result.user;
                if (!currentUser) throw new Error("User data missing from response");
                
                showScreen('dashboard');
                updateUI();
                fetchDashboardData(); 
                setInterval(fetchDashboardData, 30000);
            }
        } else {
            alert(result.message || "Login failed");
        }
    } catch (error) {
        console.error("Login request error:", error);
        alert("Server is not responding. Please check your internet or server status.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Login";
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
        // Log the error but proceed with client-side cleanup
        console.error('Logout API call failed, but proceeding with client-side logout:', error);
    } finally {
        currentUser = null;
        // Always reload the page to clear state and show login screen
        location.reload();
    }
}
async function viewMyAccounts() {
    if (!currentUser) return;
    showDashboardPanel('my-accounts-section');

    await loadSavingsInterestRateLabel();
    await applySavingsInterest(true);

    const fullName = `${currentUser.first_name} ${currentUser.last_name}`;
    const balance = parseFloat(currentUser.balance) || 0;
    const holdAmount = parseFloat(currentUser.hold_balance) || 0;
    const ledgerBalance = balance + holdAmount;
    const tradingBalance = Number(currentUser.trading_balance) || 0;

    // Top Summary
    document.getElementById('top-avail-bal').innerText = `Rs. ${balance.toLocaleString()}`;
    document.getElementById('top-ledger-bal').innerText = `Rs. ${ledgerBalance.toLocaleString()}`;
    document.getElementById('top-trading-bal').innerText = `Rs. ${tradingBalance.toLocaleString()}`;

    // Bank Tab Info
    document.getElementById('det-display-name').innerText = fullName;
    document.getElementById('det-display-acc').innerText = currentUser.account_number;
    document.getElementById('det-display-branch').innerText = currentUser.branch || 'Kathmandu Branch';
    document.getElementById('det-avail-bal').innerText = `Rs. ${balance.toLocaleString()}`;
    document.getElementById('det-ledger-bal').innerText = `Rs. ${ledgerBalance.toLocaleString()}`;
    document.getElementById('det-hold-amt').innerText = `Rs. ${holdAmount.toLocaleString()}`;

    // Trading Tab Info
    document.getElementById('det-trading-id').innerText = 'TRD-1001';
    document.getElementById('det-trading-cash').innerText = `Rs. ${tradingBalance.toLocaleString()}`;
    document.getElementById('det-portfolio-val').innerText = 'Rs. 780,000.00';

    switchAccountTab('bank-account-tab');

    const res = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
    const transactions = await res.json();
    const tableBody = document.getElementById('det-transaction-rows');
    tableBody.innerHTML = ''; 

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    // Initialize running balance with the latest balance for backward calculation
    let runningBalance = balance;

    if (transactions.length > 0) {
        transactions.forEach(t => {
            const amt = parseFloat(t.amount);
            const isCredit = t.type === 'credit' || t.type === 'interest' || t.description.toLowerCase().includes('deposit');
            
            if (isCredit) totalDeposits += amt;
            else totalWithdrawals += amt;

            const amountClass = isCredit ? 'transaction-credit' : 'transaction-debit';
            const sign = isCredit ? '+' : '-';
            
            const balanceAfterTxn = runningBalance;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding: 12px; border: 1px solid #ddd;">${new Date(t.transaction_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short'})}</td>
                <td style="padding: 12px; border: 1px solid #ddd;">${t.type.toUpperCase()}</td>
                <td style="padding: 12px; border: 1px solid #ddd;">${t.description}</td>
                <td style="padding: 12px; border: 1px solid #ddd;" class="${amountClass}">${sign}Rs. ${amt.toLocaleString()}</td>
                <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">Rs. ${balanceAfterTxn.toLocaleString()}</td>
            `;
            tableBody.appendChild(row);

            // Update running balance for the previous (older) transaction
            if (isCredit) {
                runningBalance -= amt;
            } else {
                runningBalance += amt;
            }
        });
    } else {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No transactions found.</td></tr>';
    }


    document.getElementById('card-curr-bal').innerText = `Rs. ${balance.toLocaleString()}`;
    document.getElementById('card-total-dep').innerText = `Rs. ${totalDeposits.toLocaleString()}`;
    document.getElementById('card-total-wd').innerText = `Rs. ${totalWithdrawals.toLocaleString()}`;
    document.getElementById('card-total-count').innerText = transactions.length;


    document.getElementById('info-holder').innerText = fullName;
    document.getElementById('info-number').innerText = currentUser.account_number;
    document.getElementById('info-date').innerText = currentUser.dob || '2025-01-01';
    loadTradingWallet();
}

async function loadSavingsInterestRateLabel() {
    const label = document.getElementById('savings-interest-rate-label');
    if (!label) return;
    try {
        const response = await fetch('/api/savings-interest-rate', { credentials: 'include' });
        if (!response.ok) throw new Error('Rate unavailable');
        const { rate } = await response.json();
        label.textContent = `${Number(rate).toFixed(2).replace(/\.00$/, '')}% yearly`;
    } catch (error) {
        label.textContent = 'Interest unavailable';
    }
}

async function applySavingsInterest(silent = false) {
    const response = await fetch('/api/savings-interest/apply', {
        method: 'POST', credentials: 'include'
    });
    const result = await response.json();
    if (!response.ok) {
        if (!silent) alert(result.message);
        return;
    }
    if (currentUser) currentUser.balance = Number(result.newBalance);
    if (!silent || result.interest > 0) alert(result.message);
    if (silent && result.interest > 0) {
        const balance = Number(result.newBalance) || 0;
        document.getElementById('top-avail-bal').innerText = `Rs. ${balance.toLocaleString()}`;
        document.getElementById('det-avail-bal').innerText = `Rs. ${balance.toLocaleString()}`;
        updateUI();
    }
}

async function openProfile() {
    if (!currentUser) return;
    showDashboardPanel('profile-section');
    try {
        const response = await fetch('/api/profile', { credentials: 'include' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Could not load profile.');
        const profile = result.profile;
        document.getElementById('profile-first-name').value = profile.first_name || '';
        document.getElementById('profile-last-name').value = profile.last_name || '';
        document.getElementById('profile-phone').value = profile.phone_number || '';
        document.getElementById('profile-branch').value = profile.branch || '';
        document.getElementById('profile-dob').value = profile.dob ? String(profile.dob).slice(0, 10) : '';
        document.getElementById('profile-account-number').value = profile.account_number || '';
        document.getElementById('profile-account-type').value = profile.account_type || 'Savings';
        document.getElementById('profile-status').value = profile.status || '';
        document.getElementById('profile-display-name').innerText = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        document.getElementById('profile-display-account').innerText = `Account No. ${profile.account_number || ''}`;
        document.getElementById('profile-page-image').src = profile.profile_pic || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    } catch (error) {
        alert(error.message);
        showDashboardPanel('main-view');
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const response = await fetch('/api/profile', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            firstName: document.getElementById('profile-first-name').value,
            lastName: document.getElementById('profile-last-name').value,
            phone: document.getElementById('profile-phone').value,
            branch: document.getElementById('profile-branch').value
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return alert(result.message || 'Could not save profile.');
    Object.assign(currentUser, result.profile);
    updateUI();
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    document.getElementById('profile-display-name').innerText = `${currentUser.first_name} ${currentUser.last_name}`;
    alert(result.message);
}

function withdrawalMethodLabel() {
    const method = document.getElementById('wd-method').value;
    const branch = document.getElementById('wd-branch').value.trim();
    return method === 'atm' ? 'ATM Withdrawal' : `Branch Cash Withdrawal${branch ? ` (${branch})` : ''}`;
}

function toggleWithdrawalBranch() {
    document.getElementById('wd-branch-field').classList.toggle('hidden', document.getElementById('wd-method').value !== 'branch');
}

function openWithdrawal() {
    if (!currentUser) return;
    showDashboardPanel('withdrawal-section');
    document.getElementById('wd-account-number').innerText = currentUser.account_number;
    document.getElementById('wd-available-balance').innerText = `Rs. ${(Number(currentUser.balance) || 0).toLocaleString()}`;
    document.getElementById('wd-form-container').classList.remove('hidden');
    document.getElementById('wd-confirmation').classList.add('hidden');
    document.getElementById('wd-success').classList.add('hidden');
    toggleWithdrawalBranch();
    loadWithdrawalHistory();
}

function continueWithdrawal() {
    const amount = Number(document.getElementById('wd-amount').value);
    const pin = document.getElementById('wd-pin').value;
    const isBranch = document.getElementById('wd-method').value === 'branch';
    const branch = document.getElementById('wd-branch').value.trim();
    const balance = Number(currentUser?.balance) || 0;
    if (!Number.isFinite(amount) || amount <= 0) return alert('Please enter a valid withdrawal amount.');
    if (amount > balance) return alert('Withdrawal amount cannot exceed your available balance.');
    if (amount > 100000) return alert('Daily withdrawal limit is Rs. 100,000.');
    if (isBranch && !branch) return alert('Please enter the branch name.');
    if (!/^\d{4}$/.test(pin)) return alert('Please enter your 4-digit transaction PIN.');
    document.getElementById('wd-confirm-method').innerText = withdrawalMethodLabel();
    document.getElementById('wd-confirm-amount').innerText = `Rs. ${amount.toLocaleString()}`;
    document.getElementById('wd-confirm-balance').innerText = `Rs. ${(balance - amount).toLocaleString()}`;
    document.getElementById('wd-form-container').classList.add('hidden');
    document.getElementById('wd-confirmation').classList.remove('hidden');
}

function editWithdrawal() {
    document.getElementById('wd-confirmation').classList.add('hidden');
    document.getElementById('wd-form-container').classList.remove('hidden');
}

async function processWithdrawal() {
    const button = document.getElementById('wd-submit-btn');
    button.disabled = true;
    button.innerText = 'Processing...';
    try {
        const response = await fetch('/api/withdraw', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Number(document.getElementById('wd-amount').value),
                method: document.getElementById('wd-method').value,
                branch: document.getElementById('wd-branch').value.trim(),
                pin: document.getElementById('wd-pin').value,
                remarks: document.getElementById('wd-remarks').value.trim()
            })
        });
        const responseBody = await response.text();
        let result;
        try {
            result = JSON.parse(responseBody);
        } catch {
            const endpointHint = response.status === 404
                ? 'Withdrawal service was not found. Restart the Node server and try again.'
                : 'The server returned an unexpected response. Please try again.';
            throw new Error(endpointHint);
        }
        if (!response.ok) throw new Error(result.message || 'Withdrawal failed.');
        currentUser.balance = result.newBalance;
        updateUI();
        document.getElementById('wd-confirmation').classList.add('hidden');
        document.getElementById('wd-success-message').innerText = `Rs. ${Number(document.getElementById('wd-amount').value).toLocaleString()} has been withdrawn via ${withdrawalMethodLabel()}.`;
        document.getElementById('wd-reference').innerText = result.reference;
        document.getElementById('wd-success').classList.remove('hidden');
        document.getElementById('wd-available-balance').innerText = `Rs. ${Number(result.newBalance).toLocaleString()}`;
        document.getElementById('wd-pin').value = '';
        loadWithdrawalHistory();
    } catch (error) {
        alert(error.message);
        editWithdrawal();
    } finally {
        button.disabled = false;
        button.innerText = 'Confirm Withdrawal';
    }
}

async function loadWithdrawalHistory() {
    try {
        const response = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Could not load withdrawals.');
        const withdrawals = (await response.json()).filter(transaction => String(transaction.description || '').startsWith('Withdrawal:'));
        document.getElementById('wd-history-list').innerHTML = withdrawals.length
            ? withdrawals.slice(0, 10).map(transaction => `<li>${new Date(transaction.transaction_date).toLocaleDateString()} — <strong>Rs. ${Number(transaction.amount).toLocaleString()}</strong> — ${escapeStatementHtml(transaction.description)}</li>`).join('')
            : '<li>No withdrawals yet.</li>';
    } catch (error) {
        document.getElementById('wd-history-list').innerHTML = '<li>Unable to load withdrawal history.</li>';
    }
}

function printWithdrawalReceipt() {
    const receipt = `CASH WITHDRAWAL RECEIPT - mero-Bank\n\nDate: ${new Date().toLocaleString()}\nAccount No: ${currentUser.account_number}\nMethod: ${withdrawalMethodLabel()}\nAmount: Rs. ${Number(document.getElementById('wd-amount').value).toLocaleString()}\nReference: ${document.getElementById('wd-reference').innerText}\nStatus: SUCCESSFUL`;
    const printWindow = window.open('', '', 'height=500,width=700');
    printWindow.document.write(`<pre>${receipt}</pre>`);
    printWindow.document.close();
    printWindow.print();
}

async function refreshCurrentUser() {
    const response = await fetch('/api/check-session', { credentials: 'include' });
    if (!response.ok) return false;
    const data = await response.json();
    currentUser = data.user;
    return true;
}

async function loadTradingWallet() {
    if (!currentUser) return;
    const balanceElements = [document.getElementById('wallet-trading-balance')].filter(Boolean);
    try {
        const response = await fetch('/api/trading-wallet', { credentials: 'include' });
        if (!response.ok) throw new Error('Wallet unavailable');
        const { tradingBalance } = await response.json();
        currentUser.trading_balance = Number(tradingBalance) || 0;
        balanceElements.forEach(element => element.textContent = `Rs. ${currentUser.trading_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        const bankBalance = document.getElementById('wallet-bank-balance');
        if (bankBalance) bankBalance.textContent = `Rs. ${(Number(currentUser.balance) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } catch (error) {
        console.error('Trading wallet load error:', error);
        balanceElements.forEach(element => element.textContent = 'Unavailable');
    }
}

async function transferTradingFunds(direction, inputId = 'wallet-transfer-amount', pinId = 'wallet-transaction-pin') {
    const input = document.getElementById(inputId);
    const pinInput = document.getElementById(pinId);
    const amount = Number(input.value);
    if (!Number.isFinite(amount) || amount <= 0) return alert('Enter a valid amount.');
    if (!pinInput || !/^\d{4}$/.test(pinInput.value)) return alert('Enter your 4-digit transaction PIN.');
    const response = await fetch('/api/trading-wallet/transfer', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, direction, pin: pinInput.value })
    });
    const result = await response.json();
    alert(result.message);
    if (!response.ok) return;
    currentUser.balance = Number(result.bankBalance);
    currentUser.trading_balance = Number(result.tradingBalance);
    input.value = '';
    pinInput.value = '';
    updateUI();
    loadTradingWallet();
}

function openTradingWallet() {
    showDashboardPanel('trading-wallet-section');
    loadTradingWallet();
    setTimeout(() => document.getElementById('wallet-transfer-amount')?.focus(), 0);
}

let statementTransactions = [];
let statementBalance = 0;

function statementIsCredit(transaction) {
    const description = String(transaction.description || '').toLowerCase();
    return transaction.type === 'credit' || transaction.type === 'interest' || description.includes('deposit');
}

function isBankStatementTransaction(transaction) {
    return !/^Share (Purchase|Sell):/i.test(String(transaction.description || ''));
}

function formatStatementMoney(value) {
    return `Rs. ${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeStatementHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function openStatements() {
    if (!currentUser) return;
    await viewMyAccounts();
    switchAccountTab('statements-tab');

    document.getElementById('stmt-account-info').textContent = `${currentUser.first_name} ${currentUser.last_name} · A/C ${currentUser.account_number} · ${currentUser.branch || 'Kathmandu Branch'}`;
    statementBalance = Number(currentUser.balance) || 0;
    setStatementAllTime();

    try {
        const response = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Could not load transactions');
        statementTransactions = (await response.json()).filter(isBankStatementTransaction);
        applyStatementFilters();
    } catch (error) {
        console.error('Statement load error:', error);
        document.getElementById('statement-transaction-rows').innerHTML = '<tr><td colspan="7" class="statement-empty">Unable to load your statement. Please try again.</td></tr>';
    }
}

function setStatementAllTime() {
    document.getElementById('stmt-from').value = '';
    document.getElementById('stmt-to').value = '';
    document.getElementById('stmt-type').value = 'all';
    document.getElementById('stmt-search').value = '';
    if (statementTransactions.length) applyStatementFilters();
}

function setStatementPeriod(days) {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - (days - 1));
    document.getElementById('stmt-from').value = from.toISOString().slice(0, 10);
    document.getElementById('stmt-to').value = today.toISOString().slice(0, 10);
    if (statementTransactions.length) applyStatementFilters();
}

function setStatementMonth() {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('stmt-from').value = first.toISOString().slice(0, 10);
    document.getElementById('stmt-to').value = today.toISOString().slice(0, 10);
    if (statementTransactions.length) applyStatementFilters();
}

function applyStatementFilters() {
    const from = document.getElementById('stmt-from').value;
    const to = document.getElementById('stmt-to').value;
    const type = document.getElementById('stmt-type').value;
    const search = document.getElementById('stmt-search').value.trim().toLowerCase();
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    const rows = document.getElementById('statement-transaction-rows');

    if (start && end && start > end) {
        rows.innerHTML = '<tr><td colspan="7" class="statement-empty">The “from” date must be before the “to” date.</td></tr>';
        return;
    }

    let runningBalance = statementBalance;
    const enriched = statementTransactions.map(transaction => {
        const amount = Number(transaction.amount) || 0;
        const credit = statementIsCredit(transaction);
        const balanceAfter = runningBalance;
        runningBalance += credit ? -amount : amount;
        return { ...transaction, amount, credit, balanceAfter };
    });
    const filtered = enriched.filter(transaction => {
        const date = new Date(transaction.transaction_date);
        const matchesDate = (!start || date >= start) && (!end || date <= end);
        const matchesType = type === 'all' || (type === 'credit' ? transaction.credit : !transaction.credit);
        const haystack = `${transaction.description || ''} ${transaction.id || ''}`.toLowerCase();
        return matchesDate && matchesType && (!search || haystack.includes(search));
    });

    const credits = filtered.filter(t => t.credit).reduce((sum, t) => sum + t.amount, 0);
    const debits = filtered.filter(t => !t.credit).reduce((sum, t) => sum + t.amount, 0);
    const oldest = filtered[filtered.length - 1];
    const opening = oldest ? oldest.balanceAfter + (oldest.credit ? -oldest.amount : oldest.amount) : 0;
    const closing = filtered.length ? filtered[0].balanceAfter : 0;
    document.getElementById('stmt-opening-balance').textContent = formatStatementMoney(opening);
    document.getElementById('stmt-total-credit').textContent = formatStatementMoney(credits);
    document.getElementById('stmt-total-debit').textContent = formatStatementMoney(debits);
    document.getElementById('stmt-closing-balance').textContent = formatStatementMoney(closing);
    document.getElementById('stmt-transaction-count').textContent = filtered.length;
    document.getElementById('stmt-period-label').textContent = from && to ? `${from} to ${to}` : 'All transactions';
    document.getElementById('stmt-generated-at').textContent = `Generated on ${new Date().toLocaleString()}`;

    if (!filtered.length) {
        rows.innerHTML = '<tr><td colspan="7" class="statement-empty">No transactions found for this selection.</td></tr>';
        return;
    }
    rows.innerHTML = filtered.map(transaction => {
        const date = new Date(transaction.transaction_date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        const reference = transaction.id ? `TXN-${transaction.id}` : '—';
        return `<tr><td>${date}</td><td>${escapeStatementHtml(reference)}</td><td>${escapeStatementHtml(transaction.description || 'Transaction')}</td><td class="statement-debit">${transaction.credit ? '—' : formatStatementMoney(transaction.amount)}</td><td class="statement-credit">${transaction.credit ? formatStatementMoney(transaction.amount) : '—'}</td><td>${formatStatementMoney(transaction.balanceAfter)}</td><td><span class="statement-status">Success</span></td></tr>`;
    }).join('');
}

function exportStatementCsv() {
    const table = document.querySelector('.statement-table');
    const csv = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => `"${cell.innerText.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `account-statement-${document.getElementById('stmt-from').value || 'all'}-to-${document.getElementById('stmt-to').value || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function printStatement() {
    window.print();
}

async function renderTransactionHistory(tableBodyId, transactions, currentBalance) {
    const tableBody = document.getElementById(tableBodyId);
    tableBody.innerHTML = '';
    let runningBalance = parseFloat(currentBalance) || 0;

    if (transactions.length > 0) {
        transactions.forEach(t => {
            const amt = parseFloat(t.amount);
            const isCredit = t.type === 'credit' || t.type === 'interest' || t.description.toLowerCase().includes('deposit');
            const amountClass = isCredit ? 'transaction-credit' : 'transaction-debit';
            const sign = isCredit ? '+' : '-';
            const balanceAfterTxn = runningBalance;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding: 12px; border: 1px solid #ddd;">${new Date(t.transaction_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short'})}</td>
                <td style="padding: 12px; border: 1px solid #ddd;">${t.type.toUpperCase()}</td>
                <td style="padding: 12px; border: 1px solid #ddd;">${t.description}</td>
                <td style="padding: 12px; border: 1px solid #ddd;" class="${amountClass}">${sign}Rs. ${amt.toLocaleString()}</td>
                <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">Rs. ${balanceAfterTxn.toLocaleString()}</td>
            `;
            tableBody.appendChild(row);

            // Update running balance for the previous (older) transaction
            if (isCredit) {
                runningBalance -= amt;
            } else {
                runningBalance += amt;
            }
        });
    } else {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No transactions found.</td></tr>';
    }
}

async function viewTransactionHistory() {
    if (!currentUser) return;
    showDashboardPanel('transaction-history-section');

    const res = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
    const transactions = await res.json();
    renderTransactionHistory('history-transaction-rows', transactions, currentUser.balance);
}

let reportTransactions = [];

function reportDateValue(date) {
    const value = new Date(date);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isReportCredit(transaction) {
    return transaction.type === 'credit' || transaction.type === 'interest';
}

function reportCategory(transaction) {
    const description = String(transaction.description || '').toLowerCase();
    if (description.startsWith('withdrawal:')) return 'Withdrawal';
    if (description.includes('deposit')) return 'Deposit';
    if (description.includes('transfer')) return 'Transfer';
    if (description.includes('share')) return 'Share Market';
    if (description.includes('payment') || description.includes('topup')) return 'Payment';
    return isReportCredit(transaction) ? 'Credit' : 'Debit';
}

function setDefaultReportDates() {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 29);
    document.getElementById('report-from').value = reportDateValue(from);
    document.getElementById('report-to').value = reportDateValue(to);
}

async function openReports() {
    if (!currentUser) return;
    showDashboardPanel('reports-section');
    if (!document.getElementById('report-from').value) setDefaultReportDates();
    await loadReports();
}

async function loadReports() {
    const rows = document.getElementById('report-rows');
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    const type = document.getElementById('report-type').value;
    if (from && to && from > to) return alert('The start date cannot be after the end date.');
    rows.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 25px;">Loading report...</td></tr>';
    try {
        const response = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Could not load report transactions.');
        const transactions = await response.json();
        reportTransactions = transactions.filter(transaction => {
            const date = reportDateValue(transaction.transaction_date);
            const category = reportCategory(transaction).toLowerCase();
            const matchesDate = (!from || date >= from) && (!to || date <= to);
            const matchesType = type === 'all' || (type === 'credit' && isReportCredit(transaction)) ||
                (type === 'debit' && !isReportCredit(transaction)) || category === type;
            return matchesDate && matchesType;
        });
        renderReports();
    } catch (error) {
        reportTransactions = [];
        rows.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px;">${escapeStatementHtml(error.message)}</td></tr>`;
    }
}

function renderReports() {
    let credit = 0;
    let debit = 0;
    reportTransactions.forEach(transaction => isReportCredit(transaction) ? credit += Number(transaction.amount) || 0 : debit += Number(transaction.amount) || 0);
    const money = value => `Rs. ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('report-credit').innerText = money(credit);
    document.getElementById('report-debit').innerText = money(debit);
    document.getElementById('report-net').innerText = money(credit - debit);
    document.getElementById('report-count').innerText = reportTransactions.length;
    const from = document.getElementById('report-from').value || 'All time';
    const to = document.getElementById('report-to').value || 'Today';
    document.getElementById('report-period').innerText = `Report period: ${from} to ${to}`;
    const rows = document.getElementById('report-rows');
    rows.innerHTML = reportTransactions.length ? reportTransactions.map(transaction => {
        const creditAmount = isReportCredit(transaction) ? money(Number(transaction.amount) || 0) : '—';
        const debitAmount = isReportCredit(transaction) ? '—' : money(Number(transaction.amount) || 0);
        return `<tr><td style="padding: 11px; border-bottom: 1px solid #e5e7eb;">${new Date(transaction.transaction_date).toLocaleDateString()}</td><td style="padding: 11px; border-bottom: 1px solid #e5e7eb;">${reportCategory(transaction)}</td><td style="padding: 11px; border-bottom: 1px solid #e5e7eb;">${escapeStatementHtml(transaction.description || 'Transaction')}</td><td style="padding: 11px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #15803d;">${creditAmount}</td><td style="padding: 11px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">${debitAmount}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center; padding: 25px;">No transactions found for this selection.</td></tr>';
}

function downloadReportCsv() {
    const header = ['Date', 'Category', 'Description', 'Credit', 'Debit'];
    const rows = reportTransactions.map(transaction => [
        reportDateValue(transaction.transaction_date), reportCategory(transaction), transaction.description || '',
        isReportCredit(transaction) ? Number(transaction.amount) || 0 : '',
        isReportCredit(transaction) ? '' : Number(transaction.amount) || 0
    ]);
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `financial-report-${document.getElementById('report-from').value || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function printReport() {
    const content = document.getElementById('report-print-area').innerHTML;
    const printWindow = window.open('', '', 'height=700,width=1000');
    printWindow.document.write(`<html><head><title>Financial Report</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#f1f5f9}</style></head><body><h2>mero-Bank Financial Report</h2><p>Account: ${escapeStatementHtml(currentUser.account_number)}</p>${content}</body></html>`);
    printWindow.document.close();
    printWindow.print();
}

async function viewOrderHistory() {
    if (!currentUser) return;
    showDashboardPanel('order-history-section');
    const rows = document.getElementById('order-history-rows');
    rows.innerHTML = '<tr><td colspan="7" class="market-loading">Loading orders...</td></tr>';
    try {
        const response = await fetch('/api/order-history', { credentials: 'include' });
        if (!response.ok) throw new Error('Order history unavailable');
        const orders = await response.json();
        rows.innerHTML = orders.length ? orders.map(order => `
            <tr>
                <td>${new Date(order.transaction_date).toLocaleString()}</td>
                <td><span class="order-type ${order.order_type.toLowerCase()}">${order.order_type}</span></td>
                <td><strong>${escapeMarketText(order.symbol)}</strong></td>
                <td>${order.quantity}</td>
                <td>Rs. ${Number(order.price).toFixed(2)}</td>
                <td>Rs. ${Number(order.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td><span class="order-status">Completed</span></td>
            </tr>`).join('') : '<tr><td colspan="7" class="market-loading">No share orders found.</td></tr>';
    } catch (error) {
        console.error('Error loading order history:', error);
        rows.innerHTML = '<tr><td colspan="7" class="market-loading">Could not load order history. Please try again.</td></tr>';
    }
}

function openSendMoney() {
    showDashboardPanel('send-money-section');
    if (currentUser) { 
        document.getElementById('transfer-from-acc-display').innerText = `Savings Account - ${currentUser.account_number}`;
        document.getElementById('transfer-from-info').innerText = `Available Balance : Rs. ${parseFloat(currentUser.balance).toLocaleString()}`;
        loadBeneficiaries();
    }
}

async function loadBeneficiaries() {
    const select = document.getElementById('beneficiary-select');
    const list = document.getElementById('beneficiary-list');
    if (!select || !list) return;
    try {
        const response = await fetch('/api/beneficiaries', { credentials: 'include' });
        if (!response.ok) throw new Error('Could not load beneficiaries.');
        const beneficiaries = await response.json();
        select.innerHTML = '<option value="">Saved beneficiaries</option>' + beneficiaries.map(beneficiary =>
            `<option value="${beneficiary.id}">${escapeStatementHtml(beneficiary.nickname)} - ${escapeStatementHtml(beneficiary.recipient_name)}</option>`
        ).join('');
        list.innerHTML = beneficiaries.length ? beneficiaries.map(beneficiary => `
            <span class="beneficiary-chip">
                ${escapeStatementHtml(beneficiary.nickname)} (${escapeStatementHtml(beneficiary.account_number)})
                <button type="button" title="Remove beneficiary" onclick="removeBeneficiary(${beneficiary.id})">×</button>
            </span>`).join('') : '';
    } catch (error) {
        select.innerHTML = '<option value="">Saved beneficiaries unavailable</option>';
        list.innerHTML = '';
    }
}

async function selectBeneficiary(beneficiaryId) {
    if (!beneficiaryId) return;
    const response = await fetch('/api/beneficiaries', { credentials: 'include' });
    if (!response.ok) return;
    const beneficiary = (await response.json()).find(item => String(item.id) === String(beneficiaryId));
    if (!beneficiary) return;
    document.getElementById('transfer-acc-no').value = beneficiary.account_number;
    document.getElementById('transfer-acc-name').value = beneficiary.recipient_name;
}

async function saveBeneficiary() {
    const accountNumber = document.getElementById('transfer-acc-no').value.trim();
    const nickname = document.getElementById('beneficiary-nickname').value.trim();
    const recipientName = document.getElementById('transfer-acc-name').value.trim();
    if (!accountNumber || !recipientName || recipientName === 'Account not found' || recipientName === 'Fetching name...') {
        return alert('Enter a valid same-bank recipient account first.');
    }
    if (!nickname) return alert('Enter a nickname for this beneficiary.');
    const response = await fetch('/api/beneficiaries', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber, nickname })
    });
    const result = await response.json();
    alert(result.message);
    if (response.ok) {
        document.getElementById('beneficiary-nickname').value = '';
        loadBeneficiaries();
    }
}

async function removeBeneficiary(beneficiaryId) {
    if (!confirm('Remove this saved beneficiary?')) return;
    const response = await fetch(`/api/beneficiaries/${beneficiaryId}`, {
        method: 'DELETE', credentials: 'include'
    });
    const result = await response.json();
    alert(result.message);
    if (response.ok) loadBeneficiaries();
}

function toggleOtherBankFields() {
    const transferType = document.querySelector('input[name="transfer_type"]:checked').value;
    const otherBankField = document.getElementById('other-bank-name-field');
    otherBankField.classList.toggle('hidden', transferType === 'same');
}

async function fetchRecipientName() {
    const accNo = document.getElementById('transfer-acc-no').value;
    const transferType = document.querySelector('input[name="transfer_type"]:checked').value;
    const nameDisplay = document.getElementById('transfer-acc-name');

    // Only fetch name for same bank transfers
    if (transferType === 'same' && accNo.length >= 10) {
        nameDisplay.value = "Fetching name...";
        try {
            const res = await fetch(`/api/user-by-account/${accNo}`, { credentials: 'include' });
            if (res.ok) {
                const user = await res.json();
                nameDisplay.value = `${user.first_name} ${user.last_name}`;
            } else {
                nameDisplay.value = "Account not found";
            }
        } catch (error) {
            console.error("Error fetching recipient name:", error);
            nameDisplay.value = "Error fetching name";
        }
    }
}

function handleTransferContinue() {
    const amount = document.getElementById('transfer-amount').value;
    const accNo = document.getElementById('transfer-acc-no').value;
    const pin = document.getElementById('transfer-pin').value;
    const remarks = document.getElementById('transfer-remarks').value;

    if (!accNo || !amount || !pin) return alert("Please fill all required fields.");
    if (parseFloat(amount) > currentUser.balance) return alert("Insufficient balance.");
    if (pin.length < 4) return alert("Please enter a valid Transaction PIN.");

    
    document.getElementById('conf-from-acc').innerText = currentUser.account_number;
    document.getElementById('conf-to-acc').innerText = accNo;
    document.getElementById('conf-receiver').innerText = document.getElementById('transfer-acc-name').value || "N/A";
    document.getElementById('conf-amount').innerText = `Rs. ${parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('conf-remarks').innerText = remarks || "Personal Transfer";

    showDashboardPanel('transfer-confirm-step');
}

async function processTransferFinal() {
    const btn = document.getElementById('final-transfer-btn');

    const transferTypeElem =
        document.querySelector('input[name="transfer_type"]:checked');

    if (!transferTypeElem) {
        return alert("Please select a transfer type.");
    }

    const data = {
        amount: parseFloat(document.getElementById('transfer-amount').value),
        recipientAccount: document.getElementById('transfer-acc-no').value.trim(),
        transferType: transferTypeElem.value,
        remarks: document.getElementById('transfer-remarks').value.trim() || "Fund Transfer",
        pin: document.getElementById('transfer-pin').value,
        recipientName: document.getElementById('transfer-acc-name').value.trim() || "N/A"
    };

    if (!data.amount || data.amount <= 0) {
        return alert("Please enter a valid amount.");
    }

    if (!data.recipientAccount) {
        return alert("Please enter recipient account number.");
    }

    if (!data.pin || data.pin.length !== 4) {
        return alert("Please enter a valid 4-digit transaction PIN.");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Processing...";
    }

    try {
        const res = await fetch('/api/transfer', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        let result;

        try {
            result = await res.json();
        } catch {
            throw new Error(`Server returned invalid response (${res.status})`);
        }

        if (!res.ok) {
            throw new Error(
                result.message || `Transfer failed (${res.status})`
            );
        }

        // Update balance
        if (typeof currentUser !== 'undefined') {
            currentUser.balance = result.newBalance;
            updateUI();
        }

        const now = new Date();

        const txnId =
            result.transactionId ||
            ("TXN" + now.getFullYear() + now.getTime().toString().slice(-4));

        const successTxnId =
            document.getElementById('success-txn-id');

        const successAmount =
            document.getElementById('success-amount');

        const successReceiver =
            document.getElementById('success-receiver');

        const successDate =
            document.getElementById('success-date');

        const confReceiver =
            document.getElementById('conf-receiver');

        if (!successTxnId ||
            !successAmount ||
            !successReceiver ||
            !successDate) {

            throw new Error(
                "Transfer completed, but success screen elements are missing."
            );
        }

        successTxnId.innerText = txnId;

        successAmount.innerText =
            `Rs. ${data.amount.toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}`;

        successReceiver.innerText =
            confReceiver ? confReceiver.innerText : data.recipientName;

        successDate.innerText =
            now.toISOString().split('T')[0];

        showDashboardPanel('transfer-success-step');

    } catch (error) {
        console.error('Transfer Error:', error);

        alert(
            `Transfer Failed: ${error.message}`
        );

    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Transfer Now";
        }
    }
}
function downloadTransferReceipt() {
    alert("Downloading Receipt...");
   
}


let currentBillType = "";

function openPayments() {
    showDashboardPanel('payments-selection-section');
}

function showBillForm(type) {
    currentBillType = type;
    document.getElementById('bill-type-title').innerText = `Pay ${type} Bill`;
    document.getElementById('bill-customer-id').value = "";
    document.getElementById('bill-amount').value = "";
    showDashboardPanel('bill-payment-form');
}

async function processBillPayment() {
    const customerId = document.getElementById('bill-customer-id').value;
    const amount = parseFloat(document.getElementById('bill-amount').value);

    if (!customerId || isNaN(amount) || amount <= 0) { 
        return alert("Please enter valid details.");
    }

    if (amount > currentUser.balance) {
        return alert("Insufficient balance in your account!");
    }
    const res = await fetch('/api/pay-bill', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: currentUser.id,
            amount: amount,
            billType: currentBillType,
            customerId: customerId,
        })
    });
    const result = await res.json();
    alert(result.message);
    if (res.ok) {
       
        currentUser.balance = result.newBalance; 
        updateUI();
        document.getElementById('topup-phone').value = "";
        document.getElementById('topup-amount').value = "";
        document.getElementById('topup-operator').value = "";
        showDashboardPanel('main-view');
    }
}
function filterTransactions() {
    const term = document.getElementById('search-transactions').value.toLowerCase();
    const items = document.querySelectorAll('#transaction-list li');
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(term) ? '' : 'none';
    });
}
async function openTopup() {
    showDashboardPanel('mobile-topup-section');
}
async function processTopup() {
    const phoneNum = document.getElementById('topup-phone').value;
    const operator = document.getElementById('topup-operator').value;
    const amount = parseFloat(document.getElementById('topup-amount').value);

    if (!phoneNum || !operator || isNaN(amount) || amount <= 0) {
        return alert("Please enter valid details.");
    }

    if (amount > currentUser.balance) {
        return alert("Insufficient balance!");
    }
    const res = await fetch('/api/mobile-topup', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: currentUser.id,
            amount: amount,
            operator: operator,
            phoneNum: phoneNum,
        })
    });
    const result = await res.json();
    alert(result.message);
    if (res.ok) {
        currentUser.balance = result.newBalance; 
        updateUI();
        showDashboardPanel('main-view');
    }
}
async function openLoanSystem() {
    showDashboardPanel('loan-section'); // Added credentials
    const res = await fetch('/api/my-loans', { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    const loans = await res.json();
    if (loans.length > 0) {
        document.getElementById('active-loan-info').classList.remove('hidden');
        const active = loans[0];
        document.getElementById('loan-rem-bal').innerText = `Rs. ${parseFloat(active.remaining_balance).toFixed(2)} (${active.status})`;
        document.getElementById('loan-rate').innerText = `${active.interest_rate}%`;
    }
}
async function processLoanRequest() {
    const amount = document.getElementById('loan-amount').value;
    const purpose = document.getElementById('loan-purpose').value;
    const res = await fetch('/api/request-loan', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, purpose }),
    });
    const result = await res.json();
    alert(result.message);
    openLoanSystem();
}

async function openFDSystem() { // Added credentials
    showDashboardPanel('fd-section');
    const res = await fetch('/api/my-fds', { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    const fds = await res.json();
    const list = document.getElementById('fd-list');
    if (fds.length > 0) {
        list.innerHTML = fds.map(f => `<p>Locked: <strong>Rs. ${parseFloat(f.amount).toLocaleString()}</strong> | Maturity: ${new Date(f.maturity_date).toLocaleDateString()} | Interest: ${f.interest_rate}%</p>`).join('');
    } else {
        list.innerHTML = "<p>No active FD found.</p>";
    }
}
async function processFD() {
    const amount = document.getElementById('fd-amount').value;
    const durationMonths = document.getElementById('fd-duration').value;
    const res = await fetch('/api/create-fd', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, durationMonths }),
    });
    const result = await res.json();
    alert(result.message);
    if(res.ok) { location.reload(); }
}

function switchAccountTab(tabId) {
    document.querySelectorAll('.account-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active-tab'));
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.remove('hidden');
    
    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (activeBtn) activeBtn.classList.add('active-tab');
}

document.addEventListener('DOMContentLoaded', () => {
    // Check login status as soon as the page loads

    const darkModeToggle = document.getElementById('dark-mode-toggle-user');
    const currentTheme = localStorage.getItem('user_theme');

    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeToggle.checked = true;
    }

    darkModeToggle.addEventListener('change', function() { setThemePreference(this.checked); });

    checkLoginStatus();
});
