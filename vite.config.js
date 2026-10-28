export default { server: { proxy: { '/api': { target: 'https://v6.db.transport.rest', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } } } }
