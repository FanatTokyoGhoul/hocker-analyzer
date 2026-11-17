// Нативные модули Hockey Analyzer доступны только в приложении на телефоне.
// Android-реализация: android/app/src/main/java/com/ftg/hockeyanalyzer/*.java
// iOS-реализация: ios/Sources/HockeyNativePlugin/*.swift
export const unavailable = (method: string): Promise<never> =>
  Promise.reject(new Error(`Нативный модуль недоступен: ${method} работает только в приложении`))
