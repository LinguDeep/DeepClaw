/**
 * Weather Plugin - Fetches weather data from Open-Meteo API (no API key needed)
 */
const axios = require('axios');

class WeatherPlugin {
  constructor() {
    this.NAME = 'weather';
    this.VERSION = '1.0.0';
    this.DESCRIPTION = 'Get weather information for any city';
    this.AUTHOR = 'LinguClaw';
    this.DEPENDENCIES = [];
    this.initialized = false;
  }

  async initialize(context) {
    this.context = context;
    this.initialized = true;
    return true;
  }

  async shutdown() {
    this.initialized = false;
  }

  getInfo() {
    return { name: this.NAME, version: this.VERSION, description: this.DESCRIPTION, author: this.AUTHOR, dependencies: this.DEPENDENCIES };
  }

  _defineTools() {
    return {
      getWeather: async (city) => this.getWeather(city),
      getForecast: async (city, days) => this.getForecast(city, days || 3),
    };
  }

  getTools() {
    return this._defineTools();
  }

  async getWeather(city) {
    try {
      // Geocode city name
      const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
      if (!geo.data.results || geo.data.results.length === 0) {
        return { success: false, error: `City not found: ${city}` };
      }

      const { latitude, longitude, name, country } = geo.data.results[0];

      // Get current weather
      const weather = await axios.get(`https://api.open-meteo.com/v1/forecast`, {
        params: {
          latitude, longitude,
          current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
          timezone: 'auto',
        },
      });

      const current = weather.data.current;
      const weatherDesc = this.weatherCodeToText(current.weather_code);

      return {
        success: true,
        data: {
          city: name,
          country,
          temperature: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          windSpeed: current.wind_speed_10m,
          description: weatherDesc,
          unit: '°C',
        },
        text: `${name}, ${country}: ${current.temperature_2m}°C, ${weatherDesc}, Humidity: ${current.relative_humidity_2m}%, Wind: ${current.wind_speed_10m} km/h`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getForecast(city, days) {
    try {
      const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
      if (!geo.data.results || geo.data.results.length === 0) {
        return { success: false, error: `City not found: ${city}` };
      }

      const { latitude, longitude, name, country } = geo.data.results[0];

      const weather = await axios.get(`https://api.open-meteo.com/v1/forecast`, {
        params: {
          latitude, longitude,
          daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum',
          timezone: 'auto',
          forecast_days: Math.min(days, 7),
        },
      });

      const daily = weather.data.daily;
      const forecast = daily.time.map((date, i) => ({
        date,
        maxTemp: daily.temperature_2m_max[i],
        minTemp: daily.temperature_2m_min[i],
        description: this.weatherCodeToText(daily.weather_code[i]),
        precipitation: daily.precipitation_sum[i],
      }));

      return {
        success: true,
        data: { city: name, country, forecast },
        text: forecast.map(f => `${f.date}: ${f.minTemp}°C - ${f.maxTemp}°C, ${f.description}`).join('\n'),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  weatherCodeToText(code) {
    const codes = {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
      55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
      71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 80: 'Slight rain showers',
      81: 'Moderate rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm',
    };
    return codes[code] || `Weather code ${code}`;
  }
}

module.exports = WeatherPlugin;
module.exports.default = WeatherPlugin;
