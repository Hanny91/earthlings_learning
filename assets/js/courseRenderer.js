class CourseRenderer {
    constructor() {
        this.courseData = null;
    }

    async loadCourseData() {
        try {
            const response = await fetch('/assets/data/course-data.json');
            this.courseData = await response.json();
        } catch (error) {
            console.error('Failed to load course data:', error);
        }
    }

    renderCourseCard(courseId, container) {
        if (!this.courseData || !this.courseData.courses[courseId]) {
            console.error(`Course not found: ${courseId}`);
            return;
        }

        const course = this.courseData.courses[courseId];
        const courseHTML = this.generateCourseHTML(course);
        
        if (container) {
            container.innerHTML = courseHTML;
            this.attachEventListeners(container);
        }
    }

    generateCourseHTML(course) {
        return `
            <article class="course-card card">
                <div class="course-header">
                    <h3>${course.title}</h3>
                </div>
                <div class="course-stats">
                    ${this.generateStatsHTML(course.schedule, course.pricing)}
                </div>
                <div class="content-wrapper">
                    <p class="short-content">
                        ${course.shortDescription}
                    </p>
                    <div class="full-content hidden">
                        <h4>Course Details:</h4>
                        <p>${course.fullDescription.overview}</p>
                        <p>${course.fullDescription.details}</p>
                        <p>${course.fullDescription.suitability}</p>
                        <ul>
                            ${course.features.map(feature => `<li>${feature}</li>`).join('')}
                        </ul>
                        ${this.generateActionsHTML(course.actions)}
                    </div>
                    <button class="button button--small read-more-button">Read More</button>
                </div>
            </article>
        `;
    }

    generateStatsHTML(schedule, pricing) {
        const stats = [
            {
                label: "Lesson Times",
                values: Array.isArray(schedule.times) ? schedule.times : [schedule.times]
            },
            {
                label: "Course Duration",
                values: [schedule.duration]
            },
            {
                label: "Lesson Length",
                values: [schedule.lessonLength]
            },
            {
                label: "Price",
                values: [pricing.monthly, pricing.yearly]
            },
            {
                label: "First Lesson",
                values: [schedule.firstLesson]
            },
            {
                label: "Last Lesson",
                values: [schedule.lastLesson]
            }
        ];

        return stats.map(stat => `
            <div class="stat">
                <span class="stat-label">${stat.label}</span>
                ${stat.values.map(value => `<span class="stat-value">${value}</span>`).join('')}
                ${stat.values.length > 1 && stat.label === "Lesson Times" ? '<span class="stat-value">OR</span>' : ''}
            </div>
        `).join('');
    }

    generateActionsHTML(actions) {
        return actions.map(action => {
            const downloadAttr = action.type === 'download' ? `download="${action.filename}"` : '';
            return `<a href="${action.url}" class="button" ${downloadAttr}>${action.text}</a>`;
        }).join('');
    }

    attachEventListeners(container) {
        const readMoreButton = container.querySelector('.read-more-button');
        if (readMoreButton) {
            readMoreButton.addEventListener('click', () => {
                const wrapper = readMoreButton.closest('.content-wrapper');
                const shortContent = wrapper.querySelector('.short-content');
                const fullContent = wrapper.querySelector('.full-content');
                
                if (fullContent.classList.contains('hidden')) {
                    shortContent.style.display = 'none';
                    fullContent.classList.remove('hidden');
                    readMoreButton.textContent = 'Read Less';
                } else {
                    shortContent.style.display = 'block';
                    fullContent.classList.add('hidden');
                    readMoreButton.textContent = 'Read More';
                }
            });
        }
    }

    async renderAllCourses() {
        await this.loadCourseData();
        
        // Render specific courses by their data-course-id attribute
        const courseContainers = document.querySelectorAll('[data-course-id]');
        courseContainers.forEach(container => {
            const courseId = container.getAttribute('data-course-id');
            this.renderCourseCard(courseId, container);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const courseRenderer = new CourseRenderer();
    await courseRenderer.renderAllCourses();
});

// Export for use in other scripts if needed
window.CourseRenderer = CourseRenderer;