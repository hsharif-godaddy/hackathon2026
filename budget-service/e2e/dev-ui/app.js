(function () {
  const outRequest = document.getElementById('outRequest');
  const outResponse = document.getElementById('outResponse');
  const jwtInput = document.getElementById('jwt');

  function logExchange(request, response) {
    outRequest.classList.remove('empty');
    outResponse.classList.remove('empty');
    outRequest.textContent = JSON.stringify(request, null, 2);
    outResponse.textContent = JSON.stringify(response, null, 2);
  }

  function log(obj) {
    outRequest.classList.add('empty');
    outRequest.textContent = '—';
    outResponse.classList.remove('empty');
    outResponse.textContent =
      typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  }

  function headers() {
    const h = { Accept: 'application/json' };
    const j = jwtInput.value.trim() || sessionStorage.getItem('budget_e2e_jwt');
    if (j) h.Authorization = 'Bearer ' + j;
    return h;
  }

  function bodyString(body) {
    if (body === undefined) return undefined;
    return typeof body === 'string' ? body : JSON.stringify(body);
  }

  function setInput(id, value) {
    const v = value == null ? '' : String(value).trim();
    if (!v) return;
    const el = document.getElementById(id);
    if (el) el.value = v;
  }

  function populateFromResponse(method, path, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    if (path === '/api/v1/products' && method === 'POST') {
      setInput('productKey', data.productKey);
    }

    if (path === '/api/v1/budgets' && method === 'POST') {
      setInput('budgetId', data.budgetId);
    }

    const budgetOnly = path.match(/^\/api\/v1\/budgets\/([^/]+)$/);
    if (budgetOnly) {
      if (method === 'GET') {
        setInput('budgetId', data.budgetId || budgetOnly[1]);
        setInput('productKey', data.productKey);
        const items = data.items;
        if (Array.isArray(items) && items[0] && items[0].budgetItemId) {
          setInput('budgetItemId', items[0].budgetItemId);
        }
      }
      if (method === 'PATCH' && data.budgetId) {
        setInput('budgetId', data.budgetId);
      }
    }

    const budgetItemPath = path.match(
      /^\/api\/v1\/budgets\/([^/]+)\/budget-items\/([^/]+)$/,
    );
    if (budgetItemPath && (method === 'GET' || method === 'PATCH')) {
      setInput('budgetId', data.budgetId || budgetItemPath[1]);
      setInput('budgetItemId', data.budgetItemId || budgetItemPath[2]);
    }

    const budgetItemPost = path.match(/^\/api\/v1\/budgets\/([^/]+)\/budget-items$/);
    if (budgetItemPost && method === 'POST' && data.budgetItemId) {
      setInput('budgetId', budgetItemPost[1]);
      setInput('budgetItemId', data.budgetItemId);
    }

    const sessionCollection = path.match(/^\/api\/v1\/budgets\/([^/]+)\/sessions$/);
    if (sessionCollection && method === 'POST' && data.sessionId) {
      setInput('budgetId', sessionCollection[1]);
      setInput('sessionId', data.sessionId);
    }

    const sessionOne = path.match(
      /^\/api\/v1\/budgets\/([^/]+)\/sessions\/([^/]+)$/,
    );
    if (sessionOne) {
      setInput('budgetId', data.budgetId || sessionOne[1]);
      setInput('sessionId', data.sessionId || sessionOne[2]);
    }

    const reportCollection = path.match(
      /^\/api\/v1\/budgets\/([^/]+)\/sessions\/([^/]+)\/reports$/,
    );
    if (reportCollection && method === 'POST') {
      setInput('budgetId', data.budgetId || reportCollection[1]);
      setInput('sessionId', data.sessionId || reportCollection[2]);
      setInput('reportId', data.reportId);
    }

    const reportOne = path.match(
      /^\/api\/v1\/budgets\/([^/]+)\/sessions\/([^/]+)\/reports\/([^/]+)$/,
    );
    if (reportOne && method === 'GET') {
      setInput('budgetId', data.budgetId || reportOne[1]);
      setInput('sessionId', data.sessionId || reportOne[2]);
      setInput('reportId', data.reportId || reportOne[3]);
      setInput('productKey', data.productKey);
    }

    if (path === '/api/v1/webhooks' && method === 'POST') {
      setInput('webhookId', data.webhookId);
    }

    const webhookOne = path.match(/^\/api\/v1\/webhooks\/([^/]+)$/);
    if (webhookOne && method === 'GET') {
      setInput('webhookId', data.webhookId || webhookOne[1]);
      setInput('productKey', data.productKey);
      setInput('webhookUrl', data.url);
    }
  }

  async function req(method, path, body) {
    const init = { method, headers: headers() };
    const sent = bodyString(body);
    if (sent !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = sent;
    }
    const r = await fetch(path, init);
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    const request = {
      method,
      path,
      url: new URL(path, window.location.origin).href,
    };
    if (sent !== undefined) request.body = sent;
    logExchange(request, { status: r.status, body: data });
    if (!r.ok) {
      const err = new Error('HTTP ' + r.status);
      err.budgetUiLogged = true;
      throw err;
    }
    populateFromResponse(method, path, data);
    return data;
  }

  document.getElementById('btnSaveJwt').onclick = function () {
    const j = jwtInput.value.trim();
    if (j) sessionStorage.setItem('budget_e2e_jwt', j);
    else sessionStorage.removeItem('budget_e2e_jwt');
    log({ message: j ? 'JWT saved' : 'JWT cleared' });
  };

  function fail(e) {
    if (e && e.budgetUiLogged) return;
    log({ error: String(e) });
  }

  document.getElementById('btnHealth').onclick = function () {
    req('GET', '/health').catch(fail);
  };
  document.getElementById('btnAuthCheck').onclick = function () {
    req('GET', '/api/v1/auth-check').catch(fail);
  };

  document.getElementById('btnPostProduct').onclick = function () {
    const productKey = document.getElementById('productKey').value.trim();
    req('POST', '/api/v1/products', { productKey }).catch(fail);
  };

  document.getElementById('btnPostBudget').onclick = function () {
    const raw = document.getElementById('budgetPost').value;
    req('POST', '/api/v1/budgets', raw).catch(fail);
  };
  document.getElementById('btnGetBudget').onclick = function () {
    const id = document.getElementById('budgetId').value.trim();
    req('GET', '/api/v1/budgets/' + encodeURIComponent(id)).catch(fail);
  };
  document.getElementById('btnPatchBudget').onclick = function () {
    const id = document.getElementById('budgetId').value.trim();
    const raw = document.getElementById('budgetPatch').value;
    req('PATCH', '/api/v1/budgets/' + encodeURIComponent(id), raw).catch(fail);
  };

  document.getElementById('btnGetBudgetItem').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const iid = document.getElementById('budgetItemId').value.trim();
    req(
      'GET',
      '/api/v1/budgets/' +
        encodeURIComponent(bid) +
        '/budget-items/' +
        encodeURIComponent(iid),
    ).catch(fail);
  };

  document.getElementById('btnPostSession').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const raw = document.getElementById('sessionPost').value;
    req('POST', '/api/v1/budgets/' + encodeURIComponent(bid) + '/sessions', raw).catch(
      fail,
    );
  };
  document.getElementById('btnPatchSession').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const sid = document.getElementById('sessionId').value.trim();
    const raw = document.getElementById('sessionPatch').value;
    req(
      'PATCH',
      '/api/v1/budgets/' +
        encodeURIComponent(bid) +
        '/sessions/' +
        encodeURIComponent(sid),
      raw,
    ).catch(fail);
  };
  document.getElementById('btnGetSession').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const sid = document.getElementById('sessionId').value.trim();
    req(
      'GET',
      '/api/v1/budgets/' +
        encodeURIComponent(bid) +
        '/sessions/' +
        encodeURIComponent(sid),
    ).catch(fail);
  };

  document.getElementById('btnPostWebhook').onclick = function () {
    const pk = document.getElementById('productKey').value.trim();
    const url = document.getElementById('webhookUrl').value.trim();
    req('POST', '/api/v1/webhooks', {
      eventType: 'report.created',
      productKey: pk,
      url: url,
    }).catch(fail);
  };
  document.getElementById('btnGetWebhook').onclick = function () {
    const id = document.getElementById('webhookId').value.trim();
    req('GET', '/api/v1/webhooks/' + encodeURIComponent(id)).catch(fail);
  };
  document.getElementById('btnDelWebhook').onclick = function () {
    const id = document.getElementById('webhookId').value.trim();
    req('DELETE', '/api/v1/webhooks/' + encodeURIComponent(id)).catch(fail);
  };

  document.getElementById('btnPostReport').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const sid = document.getElementById('sessionId').value.trim();
    const raw = document.getElementById('reportPost').value;
    req(
      'POST',
      '/api/v1/budgets/' +
        encodeURIComponent(bid) +
        '/sessions/' +
        encodeURIComponent(sid) +
        '/reports',
      raw,
    ).catch(fail);
  };
  document.getElementById('btnGetReport').onclick = function () {
    const bid = document.getElementById('budgetId').value.trim();
    const sid = document.getElementById('sessionId').value.trim();
    const rid = document.getElementById('reportId').value.trim();
    req(
      'GET',
      '/api/v1/budgets/' +
        encodeURIComponent(bid) +
        '/sessions/' +
        encodeURIComponent(sid) +
        '/reports/' +
        encodeURIComponent(rid),
    ).catch(fail);
  };

  const saved = sessionStorage.getItem('budget_e2e_jwt');
  if (saved) jwtInput.value = saved;
})();
