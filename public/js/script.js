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
    const symbol = document.getElementById('res-symbol').innerText;
    const price = parseFloat(document.getElementById('res-price').innerText);
    const quantity = parseInt(document.getElementById('trade-qty').value);

    if (isNaN(quantity) || quantity <= 0) return alert("Please enter valid units");

    const totalCost = quantity * price;
    if (action === 'buy' && totalCost > currentUser.balance) {
        return alert("Insufficient balance to buy these shares.");
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
            
        updateUI();
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
            <tr>
                <td>${item.symbol}</td>
                <td>${item.quantity}</td>
                <td>Rs. ${parseFloat(item.average_price).toFixed(2)}</td>
                <td>
                    <button onclick="sellFromPortfolio('${item.symbol}', ${item.quantity})" style="padding: 2px 10px; background: #e67e22; font-size: 12px; cursor: pointer;">Sell</button>
                </td>
            </tr>
        `).join('');
    } else {
        tableBody.innerHTML = "<tr><td colspan='4'>No shares in portfolio.</td></tr>";
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
    }
    if (panelId === 'my-asba-section') {
        openMyAsba();
    }
}
function openCashDeposit() {
    showDashboardPanel('cash-deposit-section');
    if (currentUser) {
        document.getElementById('cd-acc-num').value = currentUser.account_number;
        document.getElementById('cd-user-name').value = `${currentUser.first_name} ${currentUser.last_name}`;
        document.getElementById('cd-date').valueAsDate = new Date();
        loadDepositHistory();
    }
}
async function processCashDeposit() {
    const amount = parseFloat(document.getElementById('cd-amount').value);
    const date = document.getElementById('cd-date').value;
    const branch = document.getElementById('cd-branch').value;
    const receivedBy = document.getElementById('cd-received-by').value;
    const remarks = document.getElementById('cd-remarks').value;

    if (receivedBy === "") {
        alert("Teller ID is required for verification.");
        return;
    }
    if (isNaN(amount) || amount <= 0) return alert("Please enter a valid amount.");
    const res = await fetch('/api/deposit', {
        credentials: 'include',
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: currentUser.id, amount, date, branch, receivedBy, remarks }),
    });
    if (res.ok) {
        const result = await res.json();
        alert(result.message);
        currentUser.balance = result.newBalance;
        updateUI();
        loadDepositHistory();
        document.getElementById('cd-print-btn').classList.remove('hidden');
    } else {
        alert("Failed to process deposit.");
    }
}
async function loadDepositHistory() {
    const res = await fetch(`/api/transactions/${currentUser.id}`, { credentials: 'include' });
    const transactions = await res.json();
    const list = document.getElementById('cd-history-list');
    const dailyTotalElem = document.getElementById('cd-daily-total');
    
    const deposits = transactions.filter(t => t.description.toLowerCase().includes('deposit'));
    let dailyTotal = 0;

    if (deposits.length > 0) {
        list.innerHTML = deposits.map(t => {
            dailyTotal += parseFloat(t.amount); 
            const reverseBtn = `<button onclick="alert('Transaction Reversed. Amount deducted.')" style="padding: 2px 5px; font-size: 10px; background: #e74c3c;">Reverse</button>`;
            return `<li>[${new Date(t.transaction_date).toLocaleDateString()}] <strong>Rs. ${parseFloat(t.amount).toLocaleString()}</strong> - ${t.description} ${reverseBtn}</li>`;
        }).join('');
    } else {
        list.innerHTML = "No deposits yet.";
    }
    dailyTotalElem.innerText = `Rs. ${dailyTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function printDepositSlip() {
    const acc = document.getElementById('cd-acc-num').value;
    const name = document.getElementById('cd-user-name').value;
    const amt = document.getElementById('cd-amount').value;
    const date = new Date().toLocaleString();
    const branch = document.getElementById('cd-branch').value;
    const teller = document.getElementById('cd-received-by').value;

    const slipContent = `
        ===============================
        CASH DEPOSIT SLIP - mero-Bank
        ===============================
        Date: ${date}
        Branch: ${branch}
        
        Account No: ${acc}
        Account Holder: ${name}
        Deposit Amount: Rs. ${parseFloat(amt).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        
        Teller Verification: ${teller} (Verified)
        Status: SUCCESSFUL
        ===============================
    `;

    const printWindow = window.open('', '', 'height=500,width=700');
    printWindow.document.write('<pre>' + slipContent + '</pre>');
    printWindow.document.close();
    printWindow.print();
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
    if (unreadCount > 0) {
        countBadge.innerText = unreadCount;
        countBadge.classList.remove('hidden');
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
        body: JSON.stringify({ userId: currentUser.id, oldPassword, newPassword }),
    });
    const result = await res.json();
    alert(result.message);
    if(res.ok) showDashboardPanel('main-view');
}
async function uploadProfile() {
    const file = document.getElementById('profile-upload').files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
        const base64String = reader.result;
        const res = await fetch('/api/update-profile', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, image: base64String }),
        });

        if (res.ok) {
            document.getElementById('header-profile-img').src = base64String;
            document.getElementById('welcome-profile-img').src = base64String;
            alert("Profile updated!");
            currentUser.profile_pic = base64String; 
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
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
            headers: {'Content-Type': 'application/json'},
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

    const fullName = `${currentUser.first_name} ${currentUser.last_name}`;
    const balance = parseFloat(currentUser.balance) || 0;
    const holdAmount = parseFloat(currentUser.hold_balance) || 0;
    const ledgerBalance = balance + holdAmount;
    const tradingBalance = 0; 

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

function openSendMoney() {
    showDashboardPanel('send-money-section');
    
    showTransferStep('transfer-form-step');
    if (currentUser) { 
        document.getElementById('transfer-from-acc-display').innerText = `Savings Account - ${currentUser.account_number}`;
        document.getElementById('transfer-from-info').innerText = `Available Balance : Rs. ${parseFloat(currentUser.balance).toLocaleString()}`;
    }
}

function showTransferStep(stepId) {
    document.querySelectorAll('.transfer-step').forEach(step => step.classList.add('hidden'));
    document.getElementById(stepId).classList.remove('hidden');
}

async function fetchRecipientName() {
    const accNo = document.getElementById('transfer-acc-no').value;
    const nameDisplay = document.getElementById('transfer-acc-name');
    if (accNo.length >= 10) {
        nameDisplay.value = "Fetching...";
       
        setTimeout(() => {
            nameDisplay.value = "Sita Sharma"; 
        }, 1000);
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
    document.getElementById('conf-receiver').innerText = document.getElementById('transfer-acc-name').value || "Sita Sharma";
    document.getElementById('conf-amount').innerText = `Rs. ${parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('conf-remarks').innerText = remarks || "Personal Transfer";

    showTransferStep('transfer-confirm-step');
}

async function processTransferFinal() {
    const otp = document.getElementById('transfer-otp').value;
    if (!otp) return alert("Please enter OTP");

    const typeElem = document.querySelector('input[name="transfer_type"]:checked');
    const transferType = typeElem ? typeElem.value : 'Another Customer';

    const data = {
        amount: parseFloat(document.getElementById('transfer-amount').value),
        recipientAccount: document.getElementById('transfer-acc-no').value,
        transferType: transferType,
        remarks: document.getElementById('transfer-remarks').value || "Fund Transfer",
        pin: document.getElementById('transfer-pin').value
    };

    const res = await fetch('/api/transfer', {
        credentials: 'include',
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
    });

    const result = await res.json();
    if (res.ok) {
        currentUser.balance = result.newBalance;
        updateUI();
        
        
        const now = new Date();
        const txnId = "TXN" + now.getFullYear() + now.getTime().toString().slice(-4);
        document.getElementById('success-txn-id').innerText = txnId;
        document.getElementById('success-amount').innerText = `Rs. ${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('success-receiver').innerText = document.getElementById('conf-receiver').innerText;
        document.getElementById('success-date').innerText = now.toISOString().split('T')[0];

        showTransferStep('transfer-success-step');
    } else {
        alert(result.message);
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
    const items = document.querySelectorAll('#transaction-list li, #cd-history-list li');
    
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

    darkModeToggle.addEventListener('change', function() {
        if (this.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('user_theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('user_theme', 'light');
        }
    });

    checkLoginStatus();
});
