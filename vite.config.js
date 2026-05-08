import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    __AIRTABLE_KEY__: JSON.stringify(process.env.VITE_AIRTABLE_KEY || ''),
  }
})
