---
title: "洛谷 P1495 曹冲养猪 题解"
link: "luogu-p1495"
date: 2026-04-19 15:43:00
catalog: true
tags:
  - "洛谷"
  - "中国剩余定理"
categories:
  - ["算法", "题解"]
---
## 题意

试求如下同余方程组的最小非负整数解：

$\left\{\begin{array}{l}x \equiv a_{1}\left(\bmod b_{1}\right) \\x \equiv a_{2}\left(\bmod b_{2}\right) \\\cdots \\x \equiv a_{n}\left(\bmod b_{n}\right)\end{array}\right.$

其中，$b_i$​ 两两互质。

## 思路

首先，由余数的可加性可知，若可以求得以下 n 个方程的解，那便可以求出原方程的解：

$\left\{\begin{array}{l}x \equiv a_{1}\left(\bmod b_{1}\right) \\x \equiv 0\left(\bmod b_{2}\right) \\\cdots \\x \equiv 0\left(\bmod b_{n}\right)\end{array}\right.$  $\left\{\begin{array}{l}x \equiv 0\left(\bmod b_{1}\right) \\x \equiv a_{2}\left(\bmod b_{2}\right) \\\cdots \\x \equiv 0\left(\bmod b_{n}\right)\end{array}\right.$  $\left\{\begin{array}{l}x \equiv 0\left(\bmod b_{1}\right) \\x \equiv 0\left(\bmod b_{2}\right) \\\cdots \\x \equiv a_{n}\left(\bmod b_{n}\right)\end{array}\right.$ 

此时，便有原方程的解 $x=x_1​+x_2​+⋯+x_n$​。

现在，考虑将每一个方程组拿出来单独求解。我拿第一个方程组讲解：

$\left\{\begin{array}{l}x \equiv a_{1}\left(\bmod b_{1}\right) \\x \equiv 0\left(\bmod b_{2}\right) \\\cdots \\x \equiv 0\left(\bmod b_{n}\right)\end{array}\right.$

要求出如上这个方程的解，其实可以再做一步转换，先求出以下这个方程的解：

$\left\{\begin{array}{l}y \equiv a_{1}\left(\bmod b_{1}\right) \\y \equiv 0\left(\bmod b_{2}\right) \\\cdots \\y \equiv 0\left(\bmod b_{n}\right)\end{array}\right.$

由余数的可乘性得：$x_{1}=y_{1} \times a_{1}$​。同时，观察方程组可知 $y_1$​ 一定是 $\prod_{i=2}^{n} b_{i}$ 的倍数。设$\prod_{i=2}^{n} b_{i}$ 为 $m_1$​，则有 $y_{1}=m_{1} \times k_{1}$​。因为 $y_1$​ 还要满足第一个同余方程，所以此时得到：$m_{1} \times k_{1} \equiv 1 \left(\bmod b_{1}\right)$。于是，求 $y_1$​ 的问题就转换成了求 $m_{1} \bmod b_{1}$​ 的逆元的问题，可以用扩展欧几里得算法求解。

于是便可以按这种方法，求出上面的 n 个方程组的解，然后便得到了原方程的**整数解**。不过还要再进行对所有的数的乘积的取模，因为要求**最小非负整数解**。

所以，设所有的数的乘积为 k，则最终答案用式子表达便是：

$x = \sum_{i=1}^{n}k_i\times a_i \times m_i (\bmod k)$

```cpp
#include<bits/stdc++.h>
using namespace std;
typedef long long ll;

ll myul(ll a,ll b,ll mod){
    ll ans = 0;
    while(b>0){
        if(b&1) ans = (ans + a%mod)%mod;
        a = (a+a)%mod;
        b >>= 1;
    }
    return ans;
}
ll exgcd(ll A,ll B,ll &x,ll &y){
    if(!B){
        x = 1,y = 0;
        return A;
    }
    ll d = exgcd(B,A%B,x,y);
    ll t = x;
    x = y,y = t - A/B*y;
    return d;
}
ll lcm(ll A,ll B){
    ll x,y;
    ll g = exgcd(A,B,x,y);
    return (A/g*B);
}
int main(){
    int n;cin>>n;
    vector<ll> a(n+1),b(n+1);
    for(int i = 1;i<=n;i++) cin>>b[i]>>a[i];
    ll x,y;
    ll m = b[1],ans = a[1];
    for(int i = 2;i<=n;i++){
        ll A = m,B = b[i];
        ll c = (a[i] - ans%B + B)%B;
        ll g = exgcd(A,B,x,y);
        if(c%g) return -1;
        x = myul(x,c/g,B);
        ans += x*m;
        m = lcm(m,B);
        ans = (ans%m + m)%m;
    }
    cout<<ans;
    return 0;
}
```
