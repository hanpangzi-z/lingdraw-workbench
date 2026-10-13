export function useRouter() { return { replace(url) { document.querySelector('#destination').textContent = '已进入项目：'+url; }, push() {} }; }
