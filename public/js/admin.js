let allUsers = []; 
let allPendingUsers = [];
let allStocks = [];
let currentAdmin = null;

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    const darkModeToggle = document.getElementById('dark-mode-toggle-admin');
    const isAdminPanel = !!document.getElementById('admin-dashboard-container');
    const isShareAdminPanel = !!document.getElementById('share-admin-dashboard-container');
    
    let themeKey = 'theme'; // Default
    if (isAdminPanel) themeKey = 'admin_theme';
    if (isShareAdminPanel) themeKey = 'share_admin_theme';

    if (darkModeToggle) {
        const currentTheme = localStorage.getItem(themeKey);

        if (currentTheme === 'dark') {
            document.body.classList.add('dark-mode');
            darkModeToggle.checked = true;
        }

        darkModeToggle.addEventListener('change', function() {
            if (this.checked) {
                document.body.classList.add('dark-mode');
                localStorage.setItem(themeKey, 'dark');
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem(themeKey, 'light');
            }
        });
    }
    // Check if we are on the admin panel page.
    if (document.getElementById('admin-dashboard-container')) {
        checkAdminSessionAndFetchData();
    }
    // Check if we are on the share admin panel page.
    if (document.getElementById('share-admin-dashboard-container')) {
        checkAdminSessionAndFetchShareData();
    }
});

async function checkAdminSessionAndFetchData() {
    try {
        const res = await fetch('/api/check-session', { credentials: 'include' });
        if (res.ok) {
            const { user } = await res.json();
            if (user && (user.role === 'admin' || user.role === 'share_admin')) {
                currentAdmin = user;
                // Redirect if wrong admin is on wrong panel
                if (user.role === 'admin' && !document.getElementById('admin-dashboard-container')) window.location.href = '/admin-panel';
                if (user.role === 'share_admin' && !document.getElementById('share-admin-dashboard-container')) window.location.href = '/share-admin-panel';
                fetchAdminData(user); // User is an admin, fetch data
            } else {
                logoutAdmin();
            }
        } else {
            logoutAdmin();
        }
    } catch (error) {
        console.error('Admin session check failed:', error);
        logoutAdmin();
    }
}

async function fetchAdminData(adminUser, filter = "") {
    if (!adminUser) return logoutAdmin();

    const headers = { 
        'Content-Type': 'application/json',
    };
    const fetchOptions = { credentials: 'include', headers };

    try {
        const [resStats, resUsers, resPending, resNoti] = await Promise.all([
            fetch('/api/admin/stats', fetchOptions),
            fetch('/api/admin/all-users', fetchOptions),
            fetch('/api/admin/pending-requests', fetchOptions),
            fetch(`/api/notifications/${adminUser.id}`, fetchOptions)
        ]);

        if (resStats.status === 401 || resStats.status === 403) {
            console.error("Auth failed:", resStats.status);
            alert("Session Expired. Please login again.");
            localStorage.clear();
            window.location.href = 'index.html'; return;
        }

        if (!resStats.ok) console.error("Stats API failed:", resStats.status);
        if (!resUsers.ok) console.error("Users API failed:", resUsers.status);
        if (!resPending.ok) console.error("Pending API failed:", resPending.status);

        // Update UI with admin's name
        document.getElementById('admin-name').innerText = `${adminUser.first_name} ${adminUser.last_name}`;
        const stats = resStats.ok ? await resStats.json() : { totalUsers: 0, totalDeposits: 0 };
        allUsers = resUsers.ok ? await resUsers.json() : [];
        allPendingUsers = resPending.ok ? await resPending.json() : [];

        if (resNoti && resNoti.ok) {
            const notifications = await resNoti.json();
            const notiList = document.getElementById('noti-list');
            const notiCount = document.getElementById('noti-count');
            
            const unreadCount = notifications.filter(n => !n.is_read).length;
            if (unreadCount > 0) {
                notiCount.innerText = unreadCount;
                notiCount.style.display = 'block';
            } else {
                notiCount.style.display = 'none';
            }

            if (notifications.length > 0) {
                notiList.innerHTML = notifications.map(n => `<div class="noti-item">${escapeHTML(n.message)}</div>`).join('');
            }
        }

        document.getElementById('total-users').innerText = stats.totalUsers;
        const totalDeps = parseFloat(stats.totalDeposits) || 0;
        document.getElementById('total-deposits').innerText = `Rs. ${totalDeps.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        renderPendingUsers(allPendingUsers);
        renderUsers(allUsers, filter);

    } catch (err) {
        console.error("Fetch Error:", err);
        alert("Failed to connect to server. Check if your backend is running.");
    }
}

function renderPendingUsers(pendingUsers) {
    const pendingTableBody = document.getElementById('pending-table-body');
    pendingTableBody.innerHTML = pendingUsers.map(u => `
        <tr>
            <td>${escapeHTML(u.first_name)} ${escapeHTML(u.last_name)}</td>
            <td>${escapeHTML(u.account_number)}</td>
            <td>${escapeHTML(u.phone_number)}</td>
            <td>
                <button onclick="approveUser(${u.id})" style="padding: 5px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer;">Approve</button>
                <button onclick="deleteUser(${u.id})" style="padding: 5px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 5px;">Reject</button>
            </td>
        </tr>
    `).join('');
}

function renderUsers(users, filter = "") {
    const tableBody = document.getElementById('user-table-body');
    const filtered = users.filter(u => 
        u.first_name.toLowerCase().includes(filter.toLowerCase()) || 
        u.account_number.includes(filter)
    );

    tableBody.innerHTML = filtered.map(user => `
        <tr>
                <td>${escapeHTML(user.first_name)} ${escapeHTML(user.last_name)}</td>
                <td>${escapeHTML(user.account_number)}</td> 
                <td>${escapeHTML(user.phone_number)}</td>
                <td style="text-align: right;">Rs. ${parseFloat(user.balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>
                    <span class="status-badge" style="background: ${user.status === 'frozen' ? '#ffebee' : '#e8f5e9'}; color: ${user.status === 'frozen' ? '#c0392b' : '#27ae60'};">
                        ${escapeHTML(user.status) || 'active'}
                    </span>
                </td>
            <td style="display: flex; gap: 5px; flex-wrap: wrap;">
                    <button onclick="sendDirectMessage(${user.id})" style="padding: 5px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Msg</button>
                <button onclick="toggleFreeze(${user.id}, '${user.status}')" style="padding: 5px; background: #f39c12; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    ${user.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                </button>
                    <button onclick="updateBalance(${user.id})" style="padding: 5px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer;">Edit Bal</button>
                    <button onclick="deleteUser(${user.id})" style="padding: 5px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete Acc</button>
                </td>
        </tr>
    `).join('');
}

async function sendDirectMessage(id) {
    const msg = prompt("Enter message for this user:");
    if (!msg) return;

    const res = await fetch('/api/admin/send-message', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: id, message: msg }),
    });

    if (res.ok) {
        alert("Message sent!");
    } else {
        const errData = await res.json();
        alert("Failed to send message: " + errData.message);
    }
}

async function approveUser(userId) {
    if (!confirm("Approve this account?")) return;
    
    const res = await fetch('/api/admin/approve-user', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId }),
    });

    if (res.ok) {
        alert("User approved successfully!");
        checkAdminSessionAndFetchData(); // Re-fetch all data
    } else {
        alert("Failed to approve user.");
    }
}

async function toggleNotifications() {
    const dropdown = document.getElementById('noti-dropdown');
    dropdown.classList.toggle('hidden');
    
    if (!dropdown.classList.contains('hidden') && currentAdmin) {
        try {
            const res = await fetch('/api/notifications/mark-read', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) {
                document.getElementById('noti-count').style.display = 'none';
            }
        } catch (error) {
            console.error("Failed to mark notifications as read:", error);
        }
    }
}

async function updateBalance(id) {
    const action = prompt("Type 'd' for Deposit  or 'w' for Withdraw :").toLowerCase();
    if (action !== 'd' && action !== 'w') {
        alert("Invalid choice! Please type 'd' or 'w'.");
        return;
    }

    const amount = prompt("Enter amount:");
    if (amount === null || isNaN(amount) || parseFloat(amount) <= 0) {
        alert("Invalid amount!");
        return;
    }

    const res = await fetch(`/api/admin/update-balance`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: id, action: action, amount: amount }),
    });

    const result = await res.json();
    alert(result.message);
    if (res.ok) checkAdminSessionAndFetchData();
}

async function toggleFreeze(userId, currentStatus) {
    const newStatus = currentStatus === 'frozen' ? 'active' : 'frozen';
    if (!confirm(`Are you sure you want to ${newStatus} this account?`)) return;

    const res = await fetch('/api/admin/update-status', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, status: newStatus }),
    });

    if (res.ok) {
        checkAdminSessionAndFetchData();
    } else {
        alert("Failed to update account status.");
    }
}

async function deleteUser(id) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    const res = await fetch(`/api/admin/delete-user/${id}`, { 
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
        alert("User deleted!");
        checkAdminSessionAndFetchData();
    } else {
        alert("Failed to delete user.");
    }
}

document.getElementById('user-search')?.addEventListener('input', (e) => {
    renderUsers(allUsers, e.target.value.trim());
});

async function logoutAdmin() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = 'index.html';
}

// Make sure to update any HTML that calls logoutAdmin() to call this new async version.
// e.g. <button onclick="logoutAdmin()">Logout</button>

/* --- SHARE ADMIN PANEL FUNCTIONS --- */

function showShareAdminPanel(panelId) {
    // Hide all direct children of dash-main
    document.querySelectorAll('.dash-main > div').forEach(div => {
        div.classList.add('hidden');
    });

    // Show the requested panel
    const panelToShow = document.getElementById(panelId);
    if (panelToShow) {
        panelToShow.classList.remove('hidden');
    }

    // If the allotment panel is being shown, refresh the offerings list.
    if (panelId === 'allotment-panel') {
        fetchOfferingsForAllotment();
    }
    if (panelId === 'update-price-panel') { fetchStocksForUpdate(); }
}

async function checkAdminSessionAndFetchShareData() {
    try {
        const res = await fetch('/api/check-session', { credentials: 'include' });
        if (res.ok) {
            const { user } = await res.json();
            if (user && user.role === 'share_admin') {
                currentAdmin = user;
                document.getElementById('admin-name').innerText = `${user.first_name} ${user.last_name}`;
                showShareAdminPanel('share-admin-main-view'); // Show main view on load
            } else {
                logoutAdmin(); // Not a share admin or session expired
            }
        } else {
            logoutAdmin();
        }
    } catch (error) {
        console.error('Share Admin session check failed:', error);
        logoutAdmin();
    }
}

async function addShareOffering() {
    const offeringType = document.getElementById('offering-type').value;
    const companyName = document.getElementById('offering-company').value;
    const symbol = document.getElementById('offering-symbol').value.toUpperCase();
    const totalUnits = document.getElementById('offering-units').value;
    const price = document.getElementById('offering-price').value;
    const openDate = document.getElementById('offering-open-date').value;
    const closeDate = document.getElementById('offering-close-date').value;

    if (!offeringType || !companyName || !symbol || !totalUnits || !price || !openDate || !closeDate) {
        return alert("Please fill all required fields marked with *");
    }

    const res = await fetch('/api/share-admin/offerings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offeringType, companyName, symbol, totalUnits, price, openDate, closeDate })
    });

    if (res.ok) {
        alert("New share offering added successfully!");
        document.getElementById('add-offering-form').reset(); // This won't work on divs, clear manually
        showShareAdminPanel('share-admin-main-view');
    } else {
        const err = await res.json();
        alert("Failed to add offering: " + err.message);
    }
}

async function addStock() {
    const name = document.getElementById('stock-name').value;
    const symbol = document.getElementById('stock-symbol').value.toUpperCase();
    const price = document.getElementById('stock-price').value;

    if (!name || !symbol || !price) {
        return alert("Please fill all required fields for adding a stock.");
    }

    const res = await fetch('/api/share-admin/stocks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, symbol, current_price: price })
    });

    if (res.ok) {
        alert(`Stock ${symbol} has been listed successfully!`);
        document.getElementById('stock-name').value = ''; document.getElementById('stock-symbol').value = ''; document.getElementById('stock-price').value = '';
        fetchStocksForUpdate(); // Refresh the list in the update panel
    } else {
        const err = await res.json();
        alert("Failed to add stock: " + err.message);
    }
}

async function fetchOfferingsForAllotment() {
    const res = await fetch('/api/share-admin/offerings/allotment-ready', { credentials: 'include' });
    if (!res.ok) {
        console.error("Failed to fetch offerings for allotment");
        return;
    }
    const offerings = await res.json();
    const tableBody = document.getElementById('offerings-for-allotment-body');
    if (offerings.length > 0) {
        tableBody.innerHTML = offerings.map(o => `
            <tr>
                <td>${escapeHTML(o.company_name)}</td>
                <td>${escapeHTML(o.symbol)}</td>
                <td>${escapeHTML(o.status)}</td>
                <td><button class="action-btn-blue" onclick="viewApplicantsForAllotment(${o.id}, '${escapeHTML(o.company_name)}', ${o.total_units})">View Applicants & Allot</button></td>
            </tr>
        `).join('');
    } else {
        tableBody.innerHTML = '<tr><td colspan="5">No stocks listed in the system. Please add new stocks using the "List New Stock" section.</td></tr>';
    }
}

async function viewApplicantsForAllotment(offeringId, companyName, totalUnits) {
    showShareAdminPanel('allotment-details-panel');
    document.getElementById('allotment-details-header').innerText = `Allotment for ${companyName}`;
    document.getElementById('allotment-total-units').innerHTML = `<strong>Total Units Offered:</strong> ${totalUnits.toLocaleString()}`;

    // Reset previous state
    document.getElementById('applicants-for-allotment-body').innerHTML = '<tr><td colspan="5">Loading applicants...</td></tr>';
    document.getElementById('units-to-allot-input').value = 10;

    const res = await fetch(`/api/share-admin/offerings/${offeringId}/applicants`, { credentials: 'include' });
    if (!res.ok) {
        alert("Failed to fetch applicants.");
        return;
    }
    const applicants = await res.json();
    const tableBody = document.getElementById('applicants-for-allotment-body');
    
    const totalAppliedUnits = applicants.reduce((sum, a) => sum + a.applied_units, 0);
    document.getElementById('allotment-total-applicants').innerHTML = `<strong>Total Applicants:</strong> ${applicants.length}`;
    document.getElementById('allotment-total-applied-units').innerHTML = `<strong>Total Applied Units:</strong> ${totalAppliedUnits.toLocaleString()}`;

    if (applicants.length > 0) {
        tableBody.innerHTML = applicants.map((a, index) => `
            <tr id="applicant-row-${a.id}" data-status="pending">
                <td>${index + 1}</td>
                <td>${escapeHTML(a.first_name)} ${escapeHTML(a.last_name)}</td>
                <td>${a.applied_units}</td>
                <td><input type="number" id="allot-units-${a.id}" class="allot-units-input" value="10" min="0" style="display: none;"></td>
                <td>
                    <button class="action-btn-green" onclick="setApplicantStatus(${a.id}, 'allot')">Allot</button>
                    <button class="action-btn-red" onclick="setApplicantStatus(${a.id}, 'reject')">Reject</button>
                    <button class="action-btn-blue" onclick="setApplicantStatus(${a.id}, 'pending')" style="display:none;">Reset</button>
                </td>
            </tr>
        `).join('');
    } else {
        tableBody.innerHTML = '<tr><td colspan="5">No applicants for this offering.</td></tr>';
    }

    const processBtn = document.getElementById('process-allotment-btn');
    processBtn.onclick = () => processAllotment(offeringId);
}

function setApplicantStatus(applicantId, status) {
    const row = document.getElementById(`applicant-row-${applicantId}`);
    const unitsInput = document.getElementById(`allot-units-${applicantId}`);
    const [allotBtn, rejectBtn, resetBtn] = row.querySelectorAll('button');

    // Reset classes and styles
    row.classList.remove('allotted-row', 'rejected-row');
    row.style.textDecoration = 'none';
    unitsInput.style.display = 'none';
    allotBtn.style.display = 'inline-block';
    rejectBtn.style.display = 'inline-block';
    resetBtn.style.display = 'none';

    if (status === 'allot') {
        row.classList.add('allotted-row');
        unitsInput.style.display = 'inline-block';
        unitsInput.value = document.getElementById('units-to-allot-input').value || 10;
        allotBtn.style.display = 'none';
        rejectBtn.style.display = 'none';
        resetBtn.style.display = 'inline-block';
    } else if (status === 'reject') {
        row.classList.add('rejected-row');
        row.style.textDecoration = 'line-through';
        allotBtn.style.display = 'none';
        rejectBtn.style.display = 'none';
        resetBtn.style.display = 'inline-block';
    }
    row.dataset.status = status;
}

async function processAllotment(offeringId) {
    const allotments = Array.from(document.querySelectorAll('#applicants-for-allotment-body tr'))
    .filter(row => row.dataset.status === 'allot')
    .map(row => {
        const applicantId = parseInt(row.id.replace('applicant-row-', ''));
        const allottedUnits = parseInt(document.getElementById(`allot-units-${applicantId}`).value);
        return { applicantId, allottedUnits };
    });

    const rejectedCount = document.querySelectorAll('#applicants-for-allotment-body tr[data-status="reject"]').length;

    if (!confirm(`You are about to allot shares to ${allotments.length} applicant(s) and reject ${rejectedCount} applicant(s).\nThis action cannot be undone. Proceed?`)) return;

    const res = await fetch('/api/share-admin/process-allotment', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offeringId, allotments })
    });

    const result = await res.json();
    alert(result.message);

    if (res.ok) {
        showShareAdminPanel('allotment-panel');
        fetchOfferingsForAllotment(); // Refresh the list of offerings
    }
}

async function fetchStocksForUpdate() {
    const res = await fetch('/api/share-admin/stocks', { credentials: 'include' });
    if (!res.ok) {
        console.error("Failed to fetch stocks for update");
        return;
    }
    const stocks = await res.json();
    const tableBody = document.getElementById('stocks-for-update-body');
    if (stocks.length > 0) {
        tableBody.innerHTML = stocks.map(s => `
            <tr>
                <td>${escapeHTML(s.symbol)}</td>
                <td><input type="text" id="name-update-${s.id}" value="${escapeHTML(s.name)}" style="width: 100%;"></td>
                <td><input type="number" id="price-update-${s.id}" value="${parseFloat(s.current_price).toFixed(2)}" step="0.01" style="width: 100%;"></td>
                <td><button class="action-btn-blue" onclick="updateStockPrice(${s.id})">Update</button></td>
            </tr>
        `).join('');
    } else {
        tableBody.innerHTML = '<tr><td colspan="4">No stocks listed in the system. Please add new stocks using the "List New Stock" section.</td></tr>';
    }
}

async function updateStockPrice(stockId) {
    const newName = document.getElementById(`name-update-${stockId}`).value;
    const newPrice = document.getElementById(`price-update-${stockId}`).value;
    if (!newName || !newPrice || isNaN(newPrice) || newPrice < 0) {
        return alert("Please enter a valid name and price.");
    }

    const res = await fetch(`/api/share-admin/stocks/${stockId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, current_price: newPrice })
    });
    const result = await res.json();
    alert(result.message);
    if (res.ok) { fetchStocksForUpdate(); }
}