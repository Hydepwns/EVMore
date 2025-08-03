// Mock DOM for Node.js environment
if (typeof document === 'undefined') {
    global.document = {
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
        body: { appendChild: () => {}, removeChild: () => {} },
        head: { appendChild: () => {} }
    };
}

// EVMore Demo Website JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Demo state management
    const demoState = {
        currentStep: 0,
        isSwapping: false,
        exchangeRates: {
            'ETH-ATOM': 1500,
            'ETH-OSMO': 2000,
            'USDC-ATOM': 1.5,
            'USDC-OSMO': 2.0,
            'ETH-USDC': 2000, // Fallback ETH price
            'ATOM-USDC': 0.67, // Fallback ATOM price
            'OSMO-USDC': 0.5   // Fallback OSMO price
        },
        // Real market data
        marketData: {
            prices: {},
            gasPrices: {
                ethereum: 25, // Gwei
                polygon: 30,
                arbitrum: 0.1
            },
            lastUpdated: null
        },
        // Dynamic network conditions
        networkConditions: {
            ethereumGasPrice: 25, // Gwei
            cosmosGasPrice: 0.025, // uatom
            networkCongestion: 0.3, // 0-1 scale
            successRate: 99.9,
            baseRelayTime: 10, // seconds
            baseHTLCTime: 15, // seconds
            baseConfirmTime: 5 // seconds
        },
        // Fee structure
        feeStructure: {
            ethereum: {
                base: 1.20,
                perUnit: 0.001
            },
            cosmos: {
                base: 0.80,
                perUnit: 0.0005
            },
            relayer: {
                base: 0.50,
                perUnit: 0.0002
            }
        }
    };

    // DOM elements
    const fromAmount = document.getElementById('from-amount');
    const fromToken = document.getElementById('from-token');
    const toAmount = document.getElementById('to-amount');
    const toToken = document.getElementById('to-token');
    const exchangeRate = document.getElementById('exchange-rate');
    const networkFee = document.getElementById('network-fee');
    const feeBreakdown = document.getElementById('fee-breakdown');
    const estimatedTime = document.getElementById('estimated-time');
    const timeBreakdown = document.getElementById('time-breakdown');
    const successRate = document.getElementById('success-rate');
    const rateIndicator = document.getElementById('rate-indicator');
    const gasPrice = document.getElementById('gas-price');
    const gasStatus = document.getElementById('gas-status');
    const networkStatus = document.getElementById('network-status');
    const marketStatus = document.getElementById('market-status');
    const refreshPricesBtn = document.getElementById('refresh-prices');
    const swapButton = document.getElementById('swap-button');
    const timelineSteps = document.querySelectorAll('.timeline-step');

    // Initialize demo
    initDemo();
    
    // Fetch real market data immediately
    fetchMarketData().then(() => {
        // Update the UI after market data is loaded
        if (parseFloat(fromAmount.value) > 0) {
            updateSwapDetails();
        }
    });

    // CoinGecko API functions
    async function fetchMarketData() {
        try {
            // Update market status to loading
            if (marketStatus) {
                marketStatus.textContent = '⏳ Updating...';
                marketStatus.style.background = 'rgba(245, 158, 11, 0.1)';
                marketStatus.style.color = '#f59e0b';
            }
            
            // Fetch token prices
            const tokenIds = ['ethereum', 'cosmos', 'osmosis', 'usd-coin'];
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd&include_24hr_change=true`);
            const data = await response.json();
            
            demoState.marketData.prices = data;
            demoState.marketData.lastUpdated = new Date();
            
            // Update exchange rates with real data
            if (data.ethereum && data.cosmos && data.osmosis) {
                const ethPrice = data.ethereum.usd;
                const atomPrice = data.cosmos.usd;
                const osmoPrice = data.osmosis.usd;
                
                demoState.exchangeRates['ETH-ATOM'] = ethPrice / atomPrice;
                demoState.exchangeRates['ETH-OSMO'] = ethPrice / osmoPrice;
                demoState.exchangeRates['USDC-ATOM'] = 1 / atomPrice;
                demoState.exchangeRates['USDC-OSMO'] = 1 / osmoPrice;
            }
            
            // Fetch gas prices (using a gas price API)
            await fetchGasPrices();
            
            // Update UI if there's an active amount
            if (parseFloat(fromAmount.value) > 0) {
                updateSwapDetails();
            }
            
            // Update market status to success
            if (marketStatus) {
                marketStatus.textContent = '📊 Live Prices';
                marketStatus.style.background = 'rgba(16, 185, 129, 0.1)';
                marketStatus.style.color = '#10b981';
            }
            
            console.log('Market data updated:', demoState.marketData);
        } catch (error) {
            console.warn('Failed to fetch market data, using fallback values:', error);
            
            // Update market status to error
            if (marketStatus) {
                marketStatus.textContent = '⚠️ Offline';
                marketStatus.style.background = 'rgba(239, 68, 68, 0.1)';
                marketStatus.style.color = '#ef4444';
            }
            
            // Use fallback values if API fails
        }
    }
    
    async function fetchGasPrices() {
        try {
            // Use a free gas price API (GasNow API is deprecated, so we'll simulate realistic values)
            // In production, you'd use Etherscan API with a key or similar service
            const baseGasPrice = 25; // Base gas price in Gwei
            const networkLoad = Math.random(); // Simulate network load
            
            // Calculate realistic gas price based on network load
            let gasPrice;
            if (networkLoad < 0.3) {
                gasPrice = baseGasPrice * (0.8 + Math.random() * 0.4); // Low congestion
            } else if (networkLoad < 0.7) {
                gasPrice = baseGasPrice * (1.2 + Math.random() * 0.6); // Medium congestion
            } else {
                gasPrice = baseGasPrice * (2.0 + Math.random() * 1.0); // High congestion
            }
            
            demoState.marketData.gasPrices.ethereum = Math.round(gasPrice);
            demoState.networkConditions.ethereumGasPrice = Math.round(gasPrice);
            
            // Update network congestion based on gas price
            demoState.networkConditions.networkCongestion = Math.min(1, gasPrice / 50);
            
        } catch (error) {
            console.warn('Failed to fetch gas prices, using fallback values:', error);
            // Use fallback values if API fails
        }
    }

    function initDemo() {
        // Set up event listeners
        fromAmount.addEventListener('input', updateSwapDetails);
        fromToken.addEventListener('change', updateSwapDetails);
        toToken.addEventListener('change', updateSwapDetails);
        swapButton.addEventListener('click', startSwap);
        
        // Add refresh prices button listener
        if (refreshPricesBtn) {
            refreshPricesBtn.addEventListener('click', async () => {
                refreshPricesBtn.disabled = true;
                refreshPricesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                
                try {
                    await fetchMarketData();
                    updateSwapDetails();
                    showNotification('Prices refreshed successfully!', 'success');
                } catch (error) {
                    showNotification('Failed to refresh prices', 'error');
                } finally {
                    refreshPricesBtn.disabled = false;
                    refreshPricesBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                }
            });
        }

        // Initialize swap details
        updateSwapDetails();

        // Add smooth scrolling for navigation links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });

        // Add intersection observer for animations
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        // Observe elements for animation
        document.querySelectorAll('.feature-card, .arch-card, .doc-card').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });
    }

    function updateSwapDetails() {
        const fromValue = parseFloat(fromAmount.value) || 0;
        const fromTokenValue = fromToken.value;
        const toTokenValue = toToken.value;
        
        // Get exchange rate with real market data
        const rateKey = `${fromTokenValue}-${toTokenValue}`;
        let rate = demoState.exchangeRates[rateKey] || 1;
        
        // Use real market data if available
        if (demoState.marketData.prices && Object.keys(demoState.marketData.prices).length > 0) {
            const prices = demoState.marketData.prices;
            console.log('Available prices:', prices);
            
            if (fromTokenValue === 'ETH' && toTokenValue === 'ATOM' && prices.ethereum && prices.cosmos) {
                rate = prices.ethereum.usd / prices.cosmos.usd;
                console.log(`ETH price: $${prices.ethereum.usd}, ATOM price: $${prices.cosmos.usd}, Rate: ${rate}`);
            } else if (fromTokenValue === 'ETH' && toTokenValue === 'OSMO' && prices.ethereum && prices.osmosis) {
                rate = prices.ethereum.usd / prices.osmosis.usd;
                console.log(`ETH price: $${prices.ethereum.usd}, OSMO price: $${prices.osmosis.usd}, Rate: ${rate}`);
            } else if (fromTokenValue === 'USDC' && toTokenValue === 'ATOM' && prices.cosmos) {
                // USDC is always $1, so rate is 1/ATOM price
                rate = 1 / prices.cosmos.usd;
                console.log(`USDC price: $1, ATOM price: $${prices.cosmos.usd}, Rate: ${rate}`);
            } else if (fromTokenValue === 'USDC' && toTokenValue === 'OSMO' && prices.osmosis) {
                // USDC is always $1, so rate is 1/OSMO price
                rate = 1 / prices.osmosis.usd;
                console.log(`USDC price: $1, OSMO price: $${prices.osmosis.usd}, Rate: ${rate}`);
            } else {
                console.log('Using fallback rate:', rate);
            }
        } else {
            console.log('No market data available, using fallback rate:', rate);
        }
        
        // Calculate output amount
        const toValue = fromValue * rate;
        console.log(`Calculating: ${fromValue} ${fromTokenValue} * ${rate} = ${toValue} ${toTokenValue}`);
        
        // Update UI with real market data
        toAmount.value = toValue.toFixed(4);
        
        // Ensure the calculation is always visible
        if (fromValue > 0 && toValue === 0) {
            console.warn('Calculation resulted in 0, using fallback rate');
            const fallbackRate = demoState.exchangeRates[rateKey] || 1500; // Default ETH-ATOM rate
            const fallbackValue = fromValue * fallbackRate;
            toAmount.value = fallbackValue.toFixed(4);
            console.log(`Fallback calculation: ${fromValue} * ${fallbackRate} = ${fallbackValue}`);
        }
        
        // Format exchange rate with price information
        let rateDisplay = `1 ${fromTokenValue} = ${rate.toLocaleString()} ${toTokenValue}`;
        if (demoState.marketData.prices && demoState.marketData.lastUpdated) {
            const timeAgo = Math.floor((new Date() - demoState.marketData.lastUpdated) / 1000);
            rateDisplay += ` (${timeAgo < 60 ? 'Live' : `${Math.floor(timeAgo / 60)}m ago`})`;
        }
        exchangeRate.textContent = rateDisplay;
        
        // Calculate dynamic fees
        const ethereumFee = demoState.feeStructure.ethereum.base + (fromValue * demoState.feeStructure.ethereum.perUnit);
        const cosmosFee = demoState.feeStructure.cosmos.base + (fromValue * demoState.feeStructure.cosmos.perUnit);
        const relayerFee = demoState.feeStructure.relayer.base + (fromValue * demoState.feeStructure.relayer.perUnit);
        const totalFee = ethereumFee + cosmosFee + relayerFee;
        
        // Update fee display
        networkFee.textContent = `~$${totalFee.toFixed(2)}`;
        feeBreakdown.textContent = `(Ethereum: $${ethereumFee.toFixed(2)}, Cosmos: $${cosmosFee.toFixed(2)}, Relayer: $${relayerFee.toFixed(2)})`;
        
        // Calculate dynamic transfer time based on network conditions
        const congestionMultiplier = 1 + demoState.networkConditions.networkCongestion;
        const htlcTime = Math.round(demoState.networkConditions.baseHTLCTime * congestionMultiplier);
        const relayTime = Math.round(demoState.networkConditions.baseRelayTime * congestionMultiplier);
        const confirmTime = Math.round(demoState.networkConditions.baseConfirmTime * congestionMultiplier);
        const totalTime = htlcTime + relayTime + confirmTime;
        
        // Update time display
        estimatedTime.textContent = `~${totalTime} seconds`;
        timeBreakdown.textContent = `(HTLC: ${htlcTime}s, Relay: ${relayTime}s, Confirm: ${confirmTime}s)`;
        
        // Update success rate based on amount and network conditions
        const baseSuccessRate = demoState.networkConditions.successRate;
        const amountFactor = fromValue > 100 ? 0.1 : 0; // Slight decrease for large amounts
        const congestionFactor = demoState.networkConditions.networkCongestion * 0.05; // Decrease with congestion
        const finalSuccessRate = Math.max(95, baseSuccessRate - amountFactor - congestionFactor);
        
        successRate.textContent = `${finalSuccessRate.toFixed(1)}%`;
        
        // Update success rate indicator
        if (finalSuccessRate >= 99) {
            rateIndicator.textContent = '🟢 Excellent';
            rateIndicator.style.color = '#10b981';
        } else if (finalSuccessRate >= 97) {
            rateIndicator.textContent = '🟡 Good';
            rateIndicator.style.color = '#f59e0b';
        } else {
            rateIndicator.textContent = '🔴 Fair';
            rateIndicator.style.color = '#ef4444';
        }
        
        // Update gas price with real data
        let currentGasPrice = demoState.networkConditions.ethereumGasPrice;
        
        // Use real gas price if available
        if (demoState.marketData.gasPrices.ethereum) {
            currentGasPrice = demoState.marketData.gasPrices.ethereum;
        } else {
            // Fallback to simulated variation
            const gasVariation = (Math.random() - 0.5) * 10;
            currentGasPrice = Math.max(10, Math.min(100, currentGasPrice + gasVariation));
        }
        
        gasPrice.textContent = `${Math.round(currentGasPrice)} Gwei`;
        
        // Update gas status
        if (currentGasPrice <= 20) {
            gasStatus.textContent = '🟢 Low';
            gasStatus.style.color = '#10b981';
        } else if (currentGasPrice <= 50) {
            gasStatus.textContent = '🟡 Moderate';
            gasStatus.style.color = '#f59e0b';
        } else {
            gasStatus.textContent = '🔴 High';
            gasStatus.style.color = '#ef4444';
        }
        
        // Update network status
        if (networkStatus) {
            const congestion = demoState.networkConditions.networkCongestion;
            if (congestion <= 0.3) {
                networkStatus.textContent = '🟢 Low Congestion';
                networkStatus.style.color = '#10b981';
            } else if (congestion <= 0.7) {
                networkStatus.textContent = '🟡 Moderate Congestion';
                networkStatus.style.color = '#f59e0b';
            } else {
                networkStatus.textContent = '🔴 High Congestion';
                networkStatus.style.color = '#ef4444';
            }
        }
        
        // Enable/disable swap button
        swapButton.disabled = fromValue <= 0;
        swapButton.style.opacity = fromValue > 0 ? '1' : '0.5';
    }

    function startSwap() {
        if (demoState.isSwapping) return;
        
        demoState.isSwapping = true;
        demoState.currentStep = 0;
        
        // Disable inputs during swap
        fromAmount.disabled = true;
        fromToken.disabled = true;
        toToken.disabled = true;
        swapButton.disabled = true;
        swapButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Swapping...';
        
        // Reset timeline
        timelineSteps.forEach((step, index) => {
            step.classList.remove('active', 'completed');
            step.style.opacity = '0.5';
        });
        
        // Start the swap process
        simulateSwap();
    }

    function simulateSwap() {
        const steps = [
            { name: 'Connect Wallet', duration: 2000 },
            { name: 'Create HTLC', duration: 3000 },
            { name: 'Relay Transaction', duration: 4000 },
            { name: 'Complete', duration: 2000 }
        ];

        function executeStep(stepIndex) {
            if (stepIndex >= steps.length) {
                completeSwap();
                return;
            }

            const step = steps[stepIndex];
            const stepElement = timelineSteps[stepIndex];
            
            // Activate current step
            stepElement.classList.add('active');
            stepElement.style.opacity = '1';
            
            // Update step content with progress
            const stepContent = stepElement.querySelector('.step-content p');
            const originalText = stepContent.textContent;
            
            // Simulate progress updates
            let progress = 0;
            const progressInterval = setInterval(() => {
                progress += Math.random() * 20;
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(progressInterval);
                    
                    // Mark step as completed
                    stepElement.classList.remove('active');
                    stepElement.classList.add('completed');
                    
                    // Move to next step
                    setTimeout(() => executeStep(stepIndex + 1), 500);
                } else {
                    stepContent.textContent = `${originalText} (${Math.round(progress)}%)`;
                }
            }, step.duration / 10);
        }

        // Start the first step
        executeStep(0);
    }

    function completeSwap() {
        // Re-enable inputs
        fromAmount.disabled = false;
        fromToken.disabled = false;
        toToken.disabled = false;
        swapButton.disabled = false;
        
        // Update button
        swapButton.innerHTML = '<i class="fas fa-check"></i> Swap Complete!';
        swapButton.style.background = '#10b981';
        
        // Show success message
        showNotification('Swap completed successfully! 🎉', 'success');
        
        // Reset after 3 seconds
        setTimeout(() => {
            swapButton.innerHTML = '<i class="fas fa-rocket"></i> Start Swap';
            swapButton.style.background = '';
            demoState.isSwapping = false;
            
            // Reset timeline
            timelineSteps.forEach(step => {
                step.classList.remove('active', 'completed');
                step.style.opacity = '0.5';
                const stepContent = step.querySelector('.step-content p');
                stepContent.textContent = stepContent.textContent.replace(/ \(\d+%\)/, '');
            });
        }, 3000);
    }

    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : '#6366f1'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 300px;
        `;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 5000);
    }

    // Add some interactive features
    function addInteractiveFeatures() {
        // Parallax effect for hero section
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const hero = document.querySelector('.hero');
            if (hero) {
                hero.style.transform = `translateY(${scrolled * 0.5}px)`;
            }
        });

        // Animate stats on scroll
        const statsObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateStats();
                }
            });
        }, { threshold: 0.5 });

        const statsSection = document.querySelector('.hero-stats');
        if (statsSection) {
            statsObserver.observe(statsSection);
        }
    }

    function animateStats() {
        const statNumbers = document.querySelectorAll('.stat-number');
        statNumbers.forEach(stat => {
            const finalValue = stat.textContent;
            const isPercentage = finalValue.includes('%');
            const isTime = finalValue.includes('<');
            const isNumber = !isNaN(parseFloat(finalValue));
            
            if (isNumber) {
                const target = parseFloat(finalValue);
                let current = 0;
                const increment = target / 50;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    stat.textContent = Math.round(current).toLocaleString();
                }, 50);
            }
        });
    }

    // Initialize interactive features
    addInteractiveFeatures();
    
    // Start dynamic network condition updates
    startNetworkUpdates();

    // Function to simulate dynamic network conditions
    function startNetworkUpdates() {
        setInterval(() => {
            // Simulate network congestion changes
            demoState.networkConditions.networkCongestion = Math.max(0, Math.min(1, 
                demoState.networkConditions.networkCongestion + (Math.random() - 0.5) * 0.1
            ));
            
            // Simulate gas price fluctuations (only if no real data)
            if (!demoState.marketData.gasPrices.ethereum) {
                demoState.networkConditions.ethereumGasPrice = Math.max(10, Math.min(100,
                    demoState.networkConditions.ethereumGasPrice + (Math.random() - 0.5) * 5
                ));
            }
            
            // Simulate success rate variations
            demoState.networkConditions.successRate = Math.max(95, Math.min(99.9,
                demoState.networkConditions.successRate + (Math.random() - 0.5) * 0.2
            ));
            
            // Update the UI if there's an active swap amount
            if (parseFloat(fromAmount.value) > 0) {
                updateSwapDetailsWithAnimation();
            }
        }, 5000); // Update every 5 seconds
        
        // Refresh market data every 30 seconds
        setInterval(() => {
            fetchMarketData();
        }, 30000);
    }
    
    // Function to update swap details with visual animation
    function updateSwapDetailsWithAnimation() {
        // Add updating class to elements that will change
        const elementsToUpdate = [networkFee, estimatedTime, successRate, gasPrice];
        elementsToUpdate.forEach(el => {
            if (el) {
                el.classList.add('updating');
            }
        });
        
        // Update the details
        updateSwapDetails();
        
        // Remove updating class after animation
        setTimeout(() => {
            elementsToUpdate.forEach(el => {
                if (el) {
                    el.classList.remove('updating');
                }
            });
        }, 1000);
    }

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to start swap
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!demoState.isSwapping && fromAmount.value > 0) {
                startSwap();
            }
        }
        
        // Escape to reset demo
        if (e.key === 'Escape' && demoState.isSwapping) {
            e.preventDefault();
            // Reset demo state
            demoState.isSwapping = false;
            demoState.currentStep = 0;
            
            // Reset UI
            fromAmount.disabled = false;
            fromToken.disabled = false;
            toToken.disabled = false;
            swapButton.disabled = false;
            swapButton.innerHTML = '<i class="fas fa-rocket"></i> Start Swap';
            swapButton.style.background = '';
            
            // Reset timeline
            timelineSteps.forEach(step => {
                step.classList.remove('active', 'completed');
                step.style.opacity = '0.5';
                const stepContent = step.querySelector('.step-content p');
                stepContent.textContent = stepContent.textContent.replace(/ \(\d+%\)/, '');
            });
        }
    });

    // Add some fun easter eggs
    let konamiCode = [];
    const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    
    document.addEventListener('keydown', (e) => {
        konamiCode.push(e.code);
        if (konamiCode.length > konamiSequence.length) {
            konamiCode.shift();
        }
        
        if (konamiCode.join(',') === konamiSequence.join(',')) {
            showNotification('🎮 Konami code activated! You found the secret!', 'success');
            // Add some fun visual effects
            document.body.style.animation = 'rainbow 2s infinite';
            setTimeout(() => {
                document.body.style.animation = '';
            }, 2000);
        }
    });

    // Add rainbow animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes rainbow {
            0% { filter: hue-rotate(0deg); }
            100% { filter: hue-rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    // Console welcome message
    console.log(`
    EVMore Demo
    
    Available commands:
    - Press Ctrl/Cmd + Enter to start a swap
    - Press Escape to reset the demo
    - Try the Konami code for a surprise!
    
    `);
}); 