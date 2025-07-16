function initializeReadMore() {
    const readMoreButtons = document.querySelectorAll('.read-more-button');
    
    readMoreButtons.forEach(button => {
        button.addEventListener('click', () => {
            const wrapper = button.closest('.content-wrapper');
            const shortContent = wrapper.querySelector('.short-content');
            const fullContent = wrapper.querySelector('.full-content');
            
            if (fullContent.classList.contains('hidden')) {
                shortContent.style.display = 'none';
                fullContent.classList.remove('hidden');
                button.textContent = 'Read Less';
            } else {
                shortContent.style.display = 'block';
                fullContent.classList.add('hidden');
                button.textContent = 'Read More';
            }
        });
    });
}