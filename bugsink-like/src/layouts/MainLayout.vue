<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>Демо: наблюдаемость фронтенда</q-toolbar-title>
        <q-badge outline>{{ release }}</q-badge>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-pull-to-refresh @refresh="onPullRefresh" mouse>
        <router-view />
      </q-pull-to-refresh>
    </q-page-container>

    <DevPanel />
  </q-layout>
</template>

<script setup>
import DevPanel from 'components/DevPanel.vue'
import { config } from '../observability/flags'
import { requestRefetch } from '../observability/refetch'

const release = config.release

// На странице без сетевых данных (например, в корзине) подписчиков нет —
// requestRefetch() тогда разрешается сразу, и жест просто аккуратно схлопнется.
async function onPullRefresh(done) {
  await requestRefetch()
  done()
}
</script>
