<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>Демо: наблюдаемость фронтенда</q-toolbar-title>
        <q-badge outline>{{ release }}</q-badge>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <DevPanel />
  </q-layout>
</template>

<script setup>
import DevPanel from 'components/DevPanel.vue'
import { config } from '../observability/flags'

const release = config.release
</script>
