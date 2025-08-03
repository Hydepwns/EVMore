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
            'USDC-OSMO': 2.0
        }
    };

    // DOM elements
    const fromAmount = document.getElementById('from-amount');
    const fromToken = document.getElementById('from-token');
    const toAmount = document.getElementById('to-amount');
    const toToken = document.getElementById('to-token');
    const exchangeRate = document.getElementById('exchange-rate');
    const networkFee = document.getElementById('network-fee');
    const estimatedTime = document.getElementById('estimated-time');
    const swapButton = document.getElementById('swap-button');
    const timelineSteps = document.querySelectorAll('.timeline-step');

    // Initialize demo
    initDemo();

    function initDemo() {
        // Set up event listeners
        fromAmount.addEventListener('input', updateSwapDetails);
        fromToken.addEventListener('change', updateSwapDetails);
        toToken.addEventListener('change', updateSwapDetails);
        swapButton.addEventListener('click', startSwap);

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
        
        // Get exchange rate
        const rateKey = `${fromTokenValue}-${toTokenValue}`;
        const rate = demoState.exchangeRates[rateKey] || 1;
        
        // Calculate output amount
        const toValue = fromValue * rate;
        
        // Update UI
        toAmount.value = toValue.toFixed(4);
        exchangeRate.textContent = `1 ${fromTokenValue} = ${rate.toLocaleString()} ${toTokenValue}`;
        
        // Update network fee based on amount
        const fee = fromValue > 0 ? (2.50 + fromValue * 0.001).toFixed(2) : '0.00';
        networkFee.textContent = `~$${fee}`;
        
        // Update estimated time
        const time = fromValue > 0 ? '~30 seconds' : '~30 seconds';
        estimatedTime.textContent = time;
        
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
    🚀 Welcome to EVMore Demo!
    
    Available commands:
    - Press Ctrl/Cmd + Enter to start a swap
    - Press Escape to reset the demo
    - Try the Konami code for a surprise!
    
    Built with ❤️ for the hackathon
    `);
}); 