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
            this.addCourseSchema(course)
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

        // Add structured data for SEO
    addCourseSchema(course) {
        // Parse pricing information
        const monthlyPrice = course.pricing.monthly ? 
            course.pricing.monthly.replace(/[£€$]/g, '').replace('/month', '') : null;
        const yearlyPrice = course.pricing.yearly ? 
            course.pricing.yearly.replace(/[£€$]/g, '').replace('/year', '') : null;
        
        // Determine course level
        const educationalLevel = course.category === 'alevel' ? 
            'Post-Secondary Education' : 'Secondary Education';
        
        // Parse duration for ISO format
        const duration = this.parseDurationToISO(course.schedule.duration);
        
        // Parse dates
        const startDate = this.parseStartDate(course.schedule.firstLesson);
        const endDate = this.parseEndDate(course.schedule.lastLesson);

        const schema = {
            "@context": "https://schema.org",
            "@type": "Course",
            "name": course.title,
            "description": course.shortDescription,
            "provider": {
                "@type": "EducationalOrganization",
                "name": "Earthlings Learning",
                "url": "https://www.earthlingslearning.co.uk",
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Redruth",
                    "addressRegion": "Cornwall",
                    "addressCountry": "UK"
                }
            },
            "courseMode": "Online",
            "educationalLevel": educationalLevel,
            "hasCourseInstance": {
                "@type": "CourseInstance",
                "courseMode": "Online",
                "startDate": startDate,
                "endDate": endDate,
                "duration": duration,
                "instructor": {
                    "@type": "Person",
                    "name": "Damian",
                    "jobTitle": "IGCSE Earth Sciences Tutor"
                }
            }
        };

        // Add pricing if available
        if (monthlyPrice || yearlyPrice) {
            schema.offers = [];
            
            if (monthlyPrice) {
                schema.offers.push({
                    "@type": "Offer",
                    "price": monthlyPrice,
                    "priceCurrency": "GBP",
                    "priceSpecification": {
                        "@type": "UnitPriceSpecification",
                        "price": monthlyPrice,
                        "priceCurrency": "GBP",
                        "unitText": "monthly"
                    },
                    "availability": "https://schema.org/InStock"
                });
            }
            
            if (yearlyPrice) {
                schema.offers.push({
                    "@type": "Offer",
                    "price": yearlyPrice,
                    "priceCurrency": "GBP",
                    "priceSpecification": {
                        "@type": "UnitPriceSpecification",
                        "price": yearlyPrice,
                        "priceCurrency": "GBP",
                        "unitText": "yearly"
                    },
                    "availability": "https://schema.org/InStock"
                });
            }
        }

        // Add subject area based on course title
        if (course.title.includes('Environmental')) {
            schema.about = "Environmental Science";
        } else if (course.title.includes('Geography')) {
            schema.about = "Geography";
        } else if (course.title.includes('Marine')) {
            schema.about = "Marine Science";
        }

        // Create and inject the schema script
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(schema, null, 2);
        document.head.appendChild(script);
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