require('dotenv').config();

const apiPort = process.env.API_PORT || 3000;

module.exports = {
  '/api': {
    target: `http://localhost:${apiPort}`,
    secure: false,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (request) => request.removeHeader('origin'));
    },
  },
};
