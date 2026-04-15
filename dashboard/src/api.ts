import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8200' : '')

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('akela_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('akela_token')
      localStorage.removeItem('akela_user')
      window.location.href = '/pack/login'
    }
    return Promise.reject(err)
  }
)

export default api
