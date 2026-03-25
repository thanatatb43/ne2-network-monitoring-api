# Node.js API Starter

A boilerplate project for building RESTful APIs using Node.js and Express.

## Project Structure

- \`src/models\`: Database models (e.g., Sequelize/Mongoose)
- \`src/routes\`: Express routes definitions
- \`src/controllers\`: Route controllers (handle requests/responses)
- \`src/services\`: Business logic and database interactions
- \`src/middlewares\`: Custom Express middlewares
- \`src/config\`: Configuration files
- \`src/utils\`: Utility functions and helpers
- \`database/migrations\`: Database migration files
- \`database/seeders\`: Database seed files

## Setup

1. Copy \`.env.example\` to \`.env\` (if exists) or modify \`.env\`.
2. Run \`npm install\`
3. Run \`npm start\` (or configure a dev script like nodemon)

## สร้าง Model Network Devices
npx sequelize-cli model:generate --name NetworkDevices \
--attributes index:integer,pea_type:string,pea_name:string,province:string,web:string,gateway:string,dhcp:string,network_id:string,subnet:string,sub_ip1_gateway:string,sub_ip1_subnet:string,sub_ip2_gateway:string,sub_ip2_subnet:string,wan_gateway_mpls:string,wan_ip_fgt:string,vpn_main:string,vpn_backup:string,gateway_backup:string
