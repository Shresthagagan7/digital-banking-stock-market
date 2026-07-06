let allUsers = []; 
let allPendingUsers = [];
let currentAdmin = null;

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if we are on the admin panel page.
    if (document.getElementById('admin-dashboard-container')) {
        checkAdminSessionAndFetchData();
    }
});

async function checkAdminSessionAndFetchData() {
    try {
        const res = await fetch('/api/check-session', { credentials: 'include' });
        if (res.ok) {
            const { user } = await res.json();
            if (user && user.role === 'admin') {
                currentAdmin = user;
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