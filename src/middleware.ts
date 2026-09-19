import { NextRequest, NextResponse } from 'next/server';

// 页面级登录守卫：无会话 cookie 的页面访问重定向到登录页。
// 仅检查 cookie 存在性（零成本），会话真伪由各 API（requireAccount）与前端 /api/auth/me 校验。
// 注意：matcher 不含 '/'（首页必须保持 200 以通过部署健康探测）；未登录访问首页由 useAccount 的 401 自动跳登录页。
export function middleware(request: NextRequest) {
  const token = request.cookies.get('jelly_session')?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/practice', '/records', '/admin'],
};
