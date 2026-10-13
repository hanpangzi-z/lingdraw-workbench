const navigate = url => { window.history.replaceState({}, '', url); window.dispatchEvent(new Event('qa-navigation')); };
const router = { replace: navigate, push: navigate };
export const useRouter = () => router;
