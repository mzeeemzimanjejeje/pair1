const sessions = {};

function setSession(id, data, ttl = 300) {
    sessions[id] = data;
    setTimeout(() => { delete sessions[id]; }, ttl * 1000);
}

function getSession(id) {
    return sessions[id] ?? null;
}

function deleteSession(id) {
    delete sessions[id];
}

module.exports = { setSession, getSession, deleteSession };
