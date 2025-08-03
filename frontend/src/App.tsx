import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import SwapPage from './pages/Swap';
import HistoryPage from './pages/History';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative">
          {/* Background decoration - more subtle */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 via-secondary-500/3 to-accent-500/5"></div>
          
          {/* Glassmorphism Navigation */}
          <nav className="relative z-10 bg-white/90 backdrop-blur-md border-b border-white/20 shadow-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-secondary-600 rounded-lg flex items-center justify-center">
                      <i className="fas fa-exchange-alt text-white text-sm"></i>
                    </div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                      EVMore
                    </h1>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <a 
                    href="/" 
                    className="text-gray-700 hover:text-primary-600 font-medium transition-colors duration-200 relative group"
                  >
                    Swap
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary-500 group-hover:w-full transition-all duration-200"></span>
                  </a>
                  <a 
                    href="/history" 
                    className="text-gray-700 hover:text-primary-600 font-medium transition-colors duration-200 relative group"
                  >
                    History
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary-500 group-hover:w-full transition-all duration-200"></span>
                  </a>
                  <a 
                    href="https://github.com/Hydepwns/EVMore" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors duration-200 shadow-md hover:shadow-lg"
                  >
                    <i className="fab fa-github text-white"></i>
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </nav>
          
          {/* Main Content */}
          <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <Routes>
              <Route path="/" element={<SwapPage />} />
              <Route path="/history" element={<HistoryPage />} />
            </Routes>
          </main>
        </div>
      </Router>
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'rgba(255, 255, 255, 0.95)',
            color: '#1f2937',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
          },
        }}
      />
    </QueryClientProvider>
  );
}

export default App;
