import { test } from 'node:test';
import assert from 'node:assert/strict';
import router from './routes.js';
import { openapiSpec } from './openapi.js';

// Guards against exactly the drift a past review found: routes.js grew an
// unauthenticated GET/`/internal/...` twin next to several POST routes (a
// deliberate, documented pattern -- see routes.js's own comments), which
// makes it easy for a *new* protected route to be added to openapi.js
// without requireApiToken actually being wired up for it in routes.js, or
// vice versa. This walks both sources of truth and cross-checks them
// instead of trusting either alone.

// '/dblp/author/{pid}' -> '/dblp/author/{}', matching both openapi's
// {param} syntax and Express's :param/wildcard syntax so the two path
// styles can be compared segment-by-segment.
function normalizePath(path) {
    return path.split('/').map(seg => (seg.startsWith(':') || seg.startsWith('{') || seg === '*') ? '{}' : seg).join('/');
}

function expressRoutes() {
    const routes = [];
    for (const layer of router.stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
            routes.push({
                method: method.toUpperCase(),
                path: normalizePath(layer.route.path),
                middlewareNames: layer.route.stack.map(l => l.name),
            });
        }
    }
    return routes;
}

test('every path documented in openapi.js has a matching route in routes.js', () => {
    const routes = expressRoutes();
    for (const [specPath, operations] of Object.entries(openapiSpec.paths)) {
        for (const method of Object.keys(operations)) {
            const target = normalizePath(specPath);
            const match = routes.find(r => r.method === method.toUpperCase() && r.path === target);
            assert.ok(match, `openapi.js documents ${method.toUpperCase()} ${specPath} but routes.js has no matching route`);
        }
    }
});

test('every openapi.js operation marked security:[{apiToken}] is actually behind requireApiToken in routes.js', () => {
    const routes = expressRoutes();
    for (const [specPath, operations] of Object.entries(openapiSpec.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
            const isProtectedInSpec = (operation.security || []).some(s => 'apiToken' in s);
            if (!isProtectedInSpec) continue;
            const target = normalizePath(specPath);
            const match = routes.find(r => r.method === method.toUpperCase() && r.path === target);
            assert.ok(match, `no route for ${method.toUpperCase()} ${specPath}`);
            assert.ok(
                match.middlewareNames.includes('requireApiToken'),
                `openapi.js marks ${method.toUpperCase()} ${specPath} as requiring an API token, but routes.js does not apply requireApiToken to it`
            );
        }
    }
});

test('no route in routes.js applies requireApiToken to a path/method openapi.js does NOT document as protected', () => {
    // The inverse check: a route protected in routes.js but silently left
    // out of the public spec would be a maintenance trap (token-gated but
    // undiscoverable), not a security bug -- still worth catching early.
    const documented = new Set();
    for (const [specPath, operations] of Object.entries(openapiSpec.paths)) {
        for (const method of Object.keys(operations)) documented.add(`${method.toUpperCase()} ${normalizePath(specPath)}`);
    }
    for (const route of expressRoutes()) {
        if (!route.middlewareNames.includes('requireApiToken')) continue;
        assert.ok(
            documented.has(`${route.method} ${route.path}`),
            `routes.js applies requireApiToken to ${route.method} ${route.path}, but openapi.js does not document it as a protected endpoint`
        );
    }
});
