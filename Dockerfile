# Use an official Node.js runtime (Node 18 based Alpine image for a smaller footprint)
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port your app listens on (should match the proxy port in Easypanel)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
