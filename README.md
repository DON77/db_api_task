INITIALIZATION

$ cd server

$ node create-lb-tables.js

OBTAIN ACCESS TOKEN:

POST /Users
{
 "email": "test@example.com",
 "password": "123456"
}

POST /users/login 
response id = access token

---

#loopback-getting-started

This is the example application that accompanies the [Getting started with LoopBack](http://docs.strongloop.com/display/LB/Getting+started+with+LoopBack) tutorial. Follow the steps in the tutorial to create this application from scratch.

NOTE: This repository has commits for each step of the tutorial, so you can pick up the tutorial at any point along the way:

See [Getting started with LoopBack](http://docs.strongloop.com/display/LB/Getting+started+with+LoopBack) for step-by-step instructions to create this application.

---

[More LoopBack examples](https://github.com/strongloop/loopback-example)
