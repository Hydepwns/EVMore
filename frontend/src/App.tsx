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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
          <nav className="bg-white dark:bg-gray-800 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <h1 className="text-2xl font-bold text-primary-600">
                    EVMore
                  </h1>
                </div>
                <div className="flex items-center space-x-4">
                  <a href="/" className="text-gray-700 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400">
                    Swap
                  </a>
                  <a href="/history" className="text-gray-700 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400">
                    History
                  </a>
                </div>
              </div>
            </div>
          </nav>
          
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            background: '#333',
            color: '#fff',
          },
        }}
      />
    </QueryClientProvider>
  );
}

export default App;
