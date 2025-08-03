# 1inch Fusion+ Cosmos Frontend

A modern, responsive web interface for the 1inch Fusion+ Cosmos Extension, enabling seamless cross-chain swaps between Ethereum and Cosmos ecosystems.

## 🚀 Features

### Core Functionality
- **Cross-Chain Swaps**: Intuitive interface for Ethereum ↔ Cosmos swaps
- **Multi-Wallet Support**: Integrated MetaMask and Keplr wallet connections
- **Real-Time Updates**: Live transaction status monitoring
- **Transaction History**: Comprehensive swap history with filtering

### Stretch Goals Implemented
- **Beautiful UI**: Modern React interface with Tailwind CSS
- **Partial Fills**: Advanced order splitting functionality
- **Responsive Design**: Works seamlessly on desktop and mobile
- **Dark Mode**: Automatic theme detection

## 🛠️ Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Navigation
- **React Query** - Data fetching
- **Framer Motion** - Animations
- **Wagmi** - Ethereum wallet integration
- **CosmJS** - Cosmos wallet integration

## 📦 Installation

```bash
# Clone the repository
git clone <repo-url>
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## 🔧 Configuration

Create a `.env` file in the frontend directory:

```env
VITE_RELAYER_URL=http://localhost:3000
VITE_ETHEREUM_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-key
VITE_COSMOS_RPC_URL=https://rpc.testnet.cosmos.network
```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
npm run dev
# Available at http://localhost:5173
```

### Production Build
```bash
npm run build
npm run preview
```

### Run Tests
```bash
npm run test
```

## 📁 Project Structure

```
frontend/
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── SwapInterface/   # Main swap form
│   │   ├── WalletIntegration/   # Wallet connection
│   │   └── StatusMonitor/   # Transaction monitoring
│   ├── pages/           # Route pages
│   ├── services/        # API and SDK integration
│   ├── hooks/           # Custom React hooks
│   ├── utils/           # Helper functions
│   └── types/           # TypeScript definitions
├── public/              # Static assets
└── dist/               # Production build
```

## 🎨 Key Components

### SwapInterface
Main component for executing swaps:
- Chain selection
- Token selection
- Amount input with validation
- Partial fill configuration
- Swap execution

### WalletConnect
Multi-wallet management:
- MetaMask connection for Ethereum
- Keplr connection for Cosmos
- Address display and copying
- Disconnect functionality

### TransactionHistory
Swap history tracking:
- Real-time status updates
- Transaction details
- Explorer links
- Partial fill tracking

## 🔌 SDK Integration

The frontend integrates with the `@1inch/fusion-cosmos-sdk` for swap execution:

```typescript
import { FusionCosmosClient } from '@1inch/fusion-cosmos-sdk';

const client = new FusionCosmosClient({
  relayerUrl: 'http://localhost:3000'
});
```

## 🎯 Usage Guide

### Basic Swap
1. Connect both Ethereum and Cosmos wallets
2. Select source chain and token
3. Enter swap amount
4. Select destination chain and token
5. Click "Swap" to execute

### Partial Fills
1. Enable "Partial Fills" toggle
2. Adjust fill percentage (10-90%)
3. Execute partial swap
4. Monitor remaining balance

### Transaction Monitoring
- View real-time status in swap interface
- Check complete history in History tab
- Click transaction hashes for explorer details

## 🐛 Troubleshooting

### Wallet Connection Issues
- Ensure MetaMask/Keplr extensions are installed
- Check you're on correct networks (Sepolia/Cosmos Testnet)
- Try refreshing the page

### Build Errors
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version (18+ recommended)
- Verify all environment variables are set

### Transaction Failures
- Ensure sufficient gas funds
- Check token balances
- Verify relayer service is running

## 🚀 Deployment

### Vercel
```bash
npm run build
vercel --prod
```

### Netlify
```bash
npm run build
netlify deploy --prod --dir=dist
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

## 📊 Performance

- **Bundle Size**: ~600KB (gzipped: ~180KB)
- **Lighthouse Score**: 95+ Performance
- **Load Time**: < 2 seconds
- **Time to Interactive**: < 3 seconds

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📄 License

This project is part of the 1inch Fusion+ Cosmos Extension hackathon submission.

---

Built with ❤️ for the 1inch Hackathon
