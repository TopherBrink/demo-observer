const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/CatalogPage.vue') },
      { path: 'cart', component: () => import('pages/CartPage.vue') },
    ],
  },
]

export default routes
