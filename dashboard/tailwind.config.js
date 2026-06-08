/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          cream: '#FAF7F2',
          deepblue: '#1B3A5C',
          warmgray: '#F5F0EB',
          amber: '#E8A838',
          success: '#4CAF50',
          danger: '#D32F2F',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
